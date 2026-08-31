// Split out of the former monolithic app-core.js (2026 refactor).
// EQ_Module core trunk (init, buildEQ, filter math, presets) plus the
// Object.assign(...) calls that merge in the eq-*.js method-set files.
// NOTE: flagged in prior audits as the highest-risk section to further split
// without live-browser testing; left intact here.
const EQ_Module = {

        // (removed sourceSimLowFilter/HighFilter/GainNode — this trio was
        // declared twice with different values further down, and verified
        // unused anywhere in the codebase either way; pure dead state)
        deEsserFilter: { frequency: { value: 6000 }, gain: { value: 0 } },

    customEffects: {},
    customEffectsList: [],

    handleAudioFileSelection: function(files) {
        if (!files || files.length === 0) return;

        const newTracks = [];
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const key = `${f.name}-${f.size}-${f.lastModified}`;
            if (!this.loadedFiles) this.loadedFiles = new Set();

            if (!this.loadedFiles.has(key)) {
                this.loadedFiles.add(key);
                const url = URL.createObjectURL(f);
                if (!this.objectUrlsCache) this.objectUrlsCache = [];
                this.objectUrlsCache.push(url);

                newTracks.push({ file: f, url: url, name: f.name, key: key });
                if (!this._urlRegistry) this._urlRegistry = {};
                // loadedFiles already guards duplicates; the revoke check above was dead
                // code (never reached). Keep registries in sync via single assignment.
                this._urlRegistry[key] = url;
            }
        }

        if (newTracks.length > 0) {
            this.playlist = this.playlist.concat(newTracks);
            this.playPlaylistIndex(this.playlist.length - newTracks.length);
            showToast(`Successfully loaded ${newTracks.length} audio tracks.`, "📂");
        } else {
            showToast("These tracks are already loaded.", "ℹ️");
        }
    },

    injectScriptAsync: function(src) {
        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => resolve(true);
            script.onerror = () => {
                console.warn(`[Visualizer Plugin Engine] Missing or corrupt script file: ${src}`);
                resolve(false);
            };
            document.body.appendChild(script);
        });
    },

    loadCustomVisualizerEffects: async function() {
        try {
            const res = await fetch('./app/effects/visualizer.json');
            if (!res.ok) throw new Error("File visualizer.json missing");
            const list = await res.json();

            this.customEffectsList = list || [];

            for (const effect of this.customEffectsList) {
                if (effect.file) {
                    await this.injectScriptAsync(`./app/effects/${effect.file}`);

                    this.vizModes.push(effect.id);
                }
            }
        } catch (e) {
            console.warn("[Visualizer Plugin Engine] Remote visualizer.json index omitted or inactive. Standard fallbacks active.");
        }
    },

    lastClipTime: 0,
    deEsserEnabled: false,
    limiterActive: false,
    compressorActive: false,
    isProgrammaticSliderUpdate: false,
	bypassedBands: new Set(),
    deEsserSensitivity: 50,
    deEsserReductionDb: 0,
    personalityMode: 'simple',
    hoverEQNode: null,
    activeEQNode: null,
    graphFocus: 'eq',
    currentViewport: 'squig',
    isTuningLabActive: false,
    toggleAdvancedSettings: function() {
        const drawer = document.getElementById('advanced-settings-drawer');
        if (drawer) {
            drawer.classList.toggle('hidden');
        }
    },

    setSculptSubMode: function(mode) {
        PEQDB_Module.sculptMode = mode;
        const btnSimple = document.getElementById('btn-sculpt-simple');
        const btnAdvanced = document.getElementById('btn-sculpt-advanced');
        if (btnSimple && btnAdvanced) {
            if (mode === 'simple') {
                btnSimple.className = "px-2 py-1 rounded bg-pink-500 text-white transition-all cursor-pointer";
                btnAdvanced.className = "px-2 py-1 rounded text-zinc-500 hover:text-stone-300 transition-all cursor-pointer";
            } else {
                btnAdvanced.className = "px-2 py-1 rounded bg-pink-500 text-white transition-all cursor-pointer";
                btnSimple.className = "px-2 py-1 rounded text-zinc-500 hover:text-stone-300 transition-all cursor-pointer";
            }
        }

        if (mode === 'simple') {
            PEQDB_Module.resetSculptTarget();
        }
        this.drawCurve();
    },

         exportFormats: [
            { id: 'peace', name: 'Peace', icon: 'app/icons/peace.png', fn: function() { EQ_Module.exportPeace(); } },
            { id: 'wavelet', name: 'Wavelet', icon: 'app/icons/wavelet.png', fn: function() { EQ_Module.exportWavelet(); } },
            { id: 'poweramp', name: 'Poweramp', icon: 'app/icons/poweramp.png', fn: function() { EQ_Module.exportPoweramp(); } },
            { id: 'qudelix', name: 'Qudelix', icon: 'app/icons/qudelix.png', fn: function() { EQ_Module.exportQudelix(); } },
            { id: 'fxsound', name: 'FxSound', icon: 'app/icons/fxsound.png', fn: function() { EQ_Module.exportFxSound(); } }
        ],
        selectedExportFormatIdx: 0,

        cycleExportFormat: function(dir) {
            const total = this.exportFormats.length;
            this.selectedExportFormatIdx = (this.selectedExportFormatIdx + dir + total) % total;
            const current = this.exportFormats[this.selectedExportFormatIdx];
            const btn = document.getElementById('export-preset-cycle-btn');
            if (btn) {
                btn.innerHTML = `<span class="flex items-center justify-center gap-2 overflow-visible"><img src="${current.icon}" class="w-6 h-6 object-contain flex-shrink-0 inline-block anim-toggle-pop"><span class="truncate">Export: ${current.name}</span></span>`;
            }
        },

        executeCurrentExportFormat: function() {
            const current = this.exportFormats[this.selectedExportFormatIdx];
            if (current && current.fn) {
                if (window.Mascot) Mascot.triggerTemporaryExpression('grin', 1500);
                current.fn();
            }
        },

        toggleExportMenu: function() {
            this.executeCurrentExportFormat();
        },

        togglePersonalityMode: function(mode) {
        // `mode` arg historically ignored — boot calls with 'simple' but UX is
        // intended to start advanced (reverted per audit: keep always-advanced
        // unless product confirms simple default). Keep compat helper separate.
        this.personalityMode = 'advanced';
        const panelAdvanced = document.getElementById('panel-personality-advanced');
        if (panelAdvanced) panelAdvanced.classList.remove('hidden');

        const alignBtn = document.getElementById('btn-advanced-settings');
        const tableContainer = document.getElementById('sculptor-advanced-table-container');

        if (alignBtn && PEQDB_Module.targetMode !== 'sculptor') alignBtn.classList.remove('hidden');

        if (PEQDB_Module.targetMode === 'sculptor') {
            PEQDB_Module.sculptMode = 'advanced';
            if (tableContainer) tableContainer.classList.remove('hidden');
            PEQDB_Module.renderSculptMatrixTable();
        }
        this.drawCurve();
    },

    switchGraphViewport: function(viewportId) {

        this.currentViewport = 'squig';
        this.drawCurve();
    },

    toggleActiveGraphFullscreen: function() {
            const card = document.getElementById('master-graphs-card');
            const btn = document.getElementById('btn-expand-active-graph');
            if (!card || !btn) return;

            const isExpanded = card.classList.contains('is-expanded-card');

            if (!isExpanded) {
                this.isGraphExpanded = true;
                card.classList.add('is-expanded-card');
                btn.innerHTML = '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 14h6v6M20 10h-6V4M14 10l7-7M4 20l6-6"/></svg><span class="hidden sm:inline">Minimize</span>';

                card.style.setProperty('height', 'calc(100dvh - 24px)', 'important');
                card.style.setProperty('min-height', '0', 'important');
                card.style.setProperty('max-height', 'calc(100dvh - 24px)', 'important');
            } else {
                this.isGraphExpanded = false;
                card.classList.remove('is-expanded-card');
                btn.innerHTML = '<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg><span class="hidden sm:inline">Expand</span>';
                card.style.removeProperty('height');
                card.style.removeProperty('min-height');
                card.style.removeProperty('max-height');
            }

            if (window.updateExpandedAutoHide) window.updateExpandedAutoHide();

            setTimeout(() => {
                this.drawCurve();
            }, 50);
        },

    hoveredFrequency: null,
    acousticRegions: [
        { min: 20, max: 60, emoji: "🌋", title: "Sub-Bass", desc: "Visceral physical rumble, deep cinematic low-end, and sub-bass vibration." },
        { min: 60, max: 250, emoji: "🥊", title: "Bass", desc: "Mid-bass punch, kick-drum slam, bass guitar impact, and rhythmic drive." },
        { min: 250, max: 2000, emoji: "🎤", title: "Mids", desc: "Vocal body, midrange naturalness, and primary instrument warmth." },
        { min: 2000, max: 6000, emoji: "📢", title: "Upper Mids", desc: "Vocal presence, definition, projection clarity, and instrument projection." },
        { min: 6000, max: 10000, emoji: "✨", title: "Treble", desc: "Cymbal sparkle, high-frequency transient crispness, sibilance detail, and snap." },
        { min: 10000, max: 20000, emoji: "💨", title: "Air", desc: "Acoustic breathing room, head-stage width, and micro-detail resolution." }
    ],
    updateAcousticBubble: function(region) {
        const bubble = document.getElementById('acoustic-info-bubble');
        const emojiContainer = document.getElementById('aib-emoji-container');
        const titleContainer = document.getElementById('aib-title');
        const descContainer = document.getElementById('aib-description');

        if (!bubble || !emojiContainer || !titleContainer || !descContainer) return;

        if (region) {
            emojiContainer.innerHTML = `<span class="vibrant-emoji anim-match-breath" style="display: inline-block;">${region.emoji}</span>`;
            titleContainer.textContent = `${region.title} (${region.min}-${region.max >= 1000 ? (region.max/1000) + 'k' : region.max}Hz):`;
            descContainer.textContent = region.desc;

            const activeAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent-blue').trim();
            bubble.style.borderColor = activeAccent;
            bubble.style.boxShadow = `0 0 10px rgba(${getComputedStyle(document.documentElement).getPropertyValue('--accent-blue-rgb').trim()}, 0.12)`;
        } else {
            emojiContainer.innerHTML = '<span>🎯</span>';
            titleContainer.textContent = "Interactive Translator:";
            descContainer.textContent = "Hover your cursor over the graphs to translate acoustic frequency registers.";
            bubble.style.borderColor = "";
            bubble.style.boxShadow = "";
        }
    },
    activeGraphTab: 'frequency',
    staticCacheCanvas: null,
    staticCacheCtx: null,
    staticDirty: true,
    lastStaticState: null,
    autoGainMatchActive: false,
    autoGainCompensationDb: 0.0,
    switchGraphTab: function(tabId) {
        document.querySelectorAll('.graph-console-panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('#graph-master-tabs button').forEach(b => b.classList.remove('active'));

        const panel = document.getElementById('graph-panel-' + tabId);
        if (panel) panel.classList.remove('hidden');

        const btn = document.getElementById('graph-tab-' + tabId);
        if (btn) btn.classList.add('active');

        this.activeGraphTab = tabId;

        const hzBtn = document.getElementById('graph-align-hz-btn');
        const dbBtn = document.getElementById('graph-align-db-btn');
        const clearBtn = document.getElementById('graph-clear-btn');
        const modeBtn = document.getElementById('graph-mode-cycle-btn');
        const div1 = document.getElementById('graph-divider-1');

        const saveBtn = document.getElementById('graph-save-preset-btn');
        const resetBtn = document.getElementById('graph-reset-eq-btn');
        const div2 = document.getElementById('graph-divider-2');

        if (tabId === 'frequency') {
            if (hzBtn) hzBtn.classList.remove('hidden');
            if (dbBtn) dbBtn.classList.remove('hidden');
            if (clearBtn) clearBtn.classList.remove('hidden');
            if (modeBtn) modeBtn.classList.remove('hidden');
            if (div1) div1.classList.remove('hidden');

            if (saveBtn) saveBtn.classList.add('hidden');
            if (resetBtn) resetBtn.classList.add('hidden');
            if (div2) div2.classList.add('hidden');
        } else {
            if (hzBtn) hzBtn.classList.add('hidden');
            if (dbBtn) dbBtn.classList.add('hidden');
            if (clearBtn) clearBtn.classList.add('hidden');
            if (modeBtn) modeBtn.classList.add('hidden');
            if (div1) div1.classList.add('hidden');

            if (saveBtn) saveBtn.classList.remove('hidden');
            if (resetBtn) resetBtn.classList.remove('hidden');
            if (div2) div2.classList.remove('hidden');
        }

        setTimeout(() => {
            this.drawCurve();
        }, 30);
    },

    activeConsoleTab: 'filters',
    consoleModes: [
        { id: 'filters', label: 'Filters', emoji: '🎛️' },
        { id: 'acoustics', label: 'Acoustics', emoji: '🔊' },
        { id: 'presets', label: 'Presets', emoji: '⭐' }
    ],
    cycleConsoleTab: function(dir) {
        const currentIdx = this.consoleModes.findIndex(m => m.id === this.activeConsoleTab);
        const total = this.consoleModes.length;
        const nextIdx = (currentIdx + dir + total) % total;
        this.switchConsoleTab(this.consoleModes[nextIdx].id);
    },

    activeAcousticsSubTab: 'coupling',
    acousticsSubModes: [
        { id: 'coupling', label: 'Coupling', emoji: '🎧' },
        { id: 'spatial', label: 'Spatial', emoji: '🌌' },
        { id: 'effects', label: 'Effects', emoji: '📣' },
        { id: 'crossover', label: 'Crossover', emoji: '𔔀' }
    ],
    cycleAcousticsSubTab: function(dir) {
        const currentIdx = this.acousticsSubModes.findIndex(m => m.id === this.activeAcousticsSubTab);
        const total = this.acousticsSubModes.length;
        const nextIdx = (currentIdx + dir + total) % total;
        this.switchAcousticsSubTab(this.acousticsSubModes[nextIdx].id);
    },
    switchAcousticsSubTab: function(subTabId) {
        this.activeAcousticsSubTab = subTabId;
        document.querySelectorAll('.acoustics-sub-panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('#acoustics-sub-tabs button').forEach(b => b.classList.remove('active'));

        const panel = document.getElementById('as-panel-' + subTabId);
        if (panel) panel.classList.remove('hidden');

        const btn = document.getElementById('as-tab-' + subTabId);
        if (btn) btn.classList.add('active');

        const stepperLabel = document.getElementById('acoustics-sub-stepper-label');
        if (stepperLabel) {
            const info = this.acousticsSubModes.find(m => m.id === subTabId) || this.acousticsSubModes[0];
            stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
        }
    },

    switchConsoleTab: function(tabId) {
        this.activeConsoleTab = tabId;
        document.querySelectorAll('.console-panel').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('#right-console-tabs button').forEach(b => b.classList.remove('active'));

        const panel = document.getElementById('rc-panel-' + tabId);
        if (panel) panel.classList.remove('hidden');

        const btn = document.getElementById('rc-tab-' + tabId);
        if (btn) btn.classList.add('active');

        const stepperLabel = document.getElementById('rc-tab-stepper-label');
        if (stepperLabel) {
            const info = this.consoleModes.find(m => m.id === tabId) || this.consoleModes[0];
            stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
        }

        if (tabId === 'presets') {
            if (!this.activePresetCategory) {
                this.switchCategory('music');
            }
        }

        if (tabId === 'filters') {
            if (!this.activeFaderTab) {
                this.switchFaderTab('standard');
            }
        }
    },

    activeFaderTab: 'standard',
    faderModes: [
        { id: 'standard', label: 'Standard', emoji: '🎚️' },
        { id: 'advanced', label: 'Advanced', emoji: '⚙️' }
    ],
    cycleFaderTab: function(dir) {
        const currentIdx = this.faderModes.findIndex(m => m.id === this.activeFaderTab);
        const total = this.faderModes.length;
        const nextIdx = (currentIdx + dir + total) % total;
        this.switchFaderTab(this.faderModes[nextIdx].id);
    },

    presetCategories: [
        { id: 'music', label: 'Music', emoji: '🎵' },
        { id: 'gaming', label: 'Gaming', emoji: '🎮' },
        { id: 'media', label: 'Film', emoji: '🎬' },
        { id: 'audiophile', label: 'Audio', emoji: '🎧' },
        { id: 'basshead', label: 'Bass', emoji: '🔥' },
        { id: 'custom', label: 'Custom', emoji: '⭐' }
    ],
    cyclePresetCategory: function(dir) {
        const currentIdx = this.presetCategories.findIndex(m => m.id === (this.activePresetCategory || 'music'));
        const total = this.presetCategories.length;
        const nextIdx = (currentIdx + dir + total) % total;
        this.switchCategory(this.presetCategories[nextIdx].id);
    },
    crossfeedState: 'on',
    speakerSimMode: 'natural',
    stereoExpandLevel: 0,
    tempoActive: false,
    tempoSpeed: 1.0,
    reverbActive: false,
    reverbPresetSelected: 'small_room',
    reverbParams: { mix: 0, size: 0.0, damp: 0.53, filter: 1.0, fade: 1.0, predelay: 0.00, predelaymix: 0.62 },

    reverbPresetOptions: ['small_room', 'studio', 'light_reverb', 'auditorium', 'scene', 'great_hall', 'stadium', 'echo'],

    reverbPresets: {
            small_room: { damp: 0.53, filter: 1.00, fade: 1.00, predelay: 0.00, predelaymix: 0.62, size: 0.00, wet: 0.32, label: '🚪 Small Room' },
            studio: { damp: 0.99, filter: 0.11, fade: 1.00, predelay: 0.04, predelaymix: 0.44, size: 0.03, wet: 0.47, label: '🎙️ Studio' },
            light_reverb: { damp: 0.44, filter: 0.80, fade: 0.32, predelay: 0.25, predelaymix: 0.35, size: 0.60, wet: 0.38, label: '🫧 Light Reverb' },
            auditorium: { damp: 0.90, filter: 0.70, fade: 0.81, predelay: 0.00, predelaymix: 0.00, size: 0.00, wet: 0.50, label: '🏛️ Auditorium' },
            scene: { damp: 0.41, filter: 0.70, fade: 0.50, predelay: 0.12, predelaymix: 0.43, size: 0.24, wet: 0.45, label: '🎬 Scene' },
            great_hall: { damp: 0.26, filter: 0.71, fade: 0.00, predelay: 0.95, predelaymix: 0.53, size: 0.52, wet: 0.44, label: '🏛️ Great Hall' },
            stadium: { damp: 0.84, filter: 0.62, fade: 0.83, predelay: 0.45, predelaymix: 0.74, size: 0.99, wet: 0.38, label: '🏟️ Stadium' },
            echo: { damp: 0.36, filter: 0.91, fade: 0.27, predelay: 0.54, predelaymix: 0.58, size: 0.73, wet: 0.37, label: '🗣️ Echo' }
        },

    updateStereoExpand: function(val) {
        this.stereoExpandLevel = parseFloat(val);
        const valEl = document.getElementById('stereo-expand-val');
        if (valEl) valEl.textContent = val + "%";
        this.updateCrossfeedDSP();
    },

    graphModes: [
        { id: 'normal', label: '🎯 Exact' },
        { id: 'difference', label: '↔️ Relative' },
        { id: 'quality', label: '📏 Tolerance' },
        { id: 'heatmap', label: '🌡️ Heatmap' }
    ],
    currentGraphModeIdx: 0,
    cycleGraphMode: function() {
        this.currentGraphModeIdx = (this.currentGraphModeIdx + 1) % this.graphModes.length;
        const mode = this.graphModes[this.currentGraphModeIdx];
        this.changeGraphMode(mode.id);
    },
    bands: [
            {hz:31,name:"Sub Bass",emoji:"🌋", type:"peaking", defaultQ:1.0},
            {hz:62,name:"Bass",emoji:"🔊", type:"peaking", defaultQ:1.0},
            {hz:125,name:"Low Mids",emoji:"🌊", type:"peaking", defaultQ:1.0},
            {hz:250,name:"Mids",emoji:"🎤", type:"peaking", defaultQ:1.0},
            {hz:500,name:"Upper Mids",emoji:"📢", type:"peaking", defaultQ:1.0},
            {hz:1000,name:"Presence",emoji:"⚠️", type:"peaking", defaultQ:1.0},
            {hz:2000,name:"Treble",emoji:"✨", type:"peaking", defaultQ:1.0},
            {hz:4000,name:"Air",emoji:"💨", type:"peaking", defaultQ:1.0},
            {hz:8000,name:"Ultra Air",emoji:"☁️", type:"peaking", defaultQ:1.0},
            {hz:16000,name:"Detail",emoji:"🧬", type:"peaking", defaultQ:1.0}
        ],
        advancedBands: [
            {hz:20, name:"Sub Ext", emoji:"🌀", type:"lowshelf", defaultQ:0.7},
            {hz:60, name:"Punch", emoji:"🥊", type:"peaking", defaultQ:1.5},
            {hz:150, name:"Warmth", emoji:"🔥", type:"peaking", defaultQ:1.0},
            {hz:300, name:"Body", emoji:"🪵", type:"peaking", defaultQ:1.0},
            {hz:600, name:"Vocals", emoji:"🎤", type:"peaking", defaultQ:1.2},
            {hz:1200, name:"Clarity", emoji:"💡", type:"peaking", defaultQ:1.2},
            {hz:3000, name:"Presence+", emoji:"⚡", type:"peaking", defaultQ:1.2},
            {hz:6000, name:"Air Boost", emoji:"💨", type:"highshelf", defaultQ:0.7},
            {hz:10000, name:"Sparkle", emoji:"✨", type:"highshelf", defaultQ:1.1},
            {hz:14000, name:"Ultra Air", emoji:"🧠", type:"highshelf", defaultQ:0.7}
        ],
        activePreset: null,
        graphMode: 'normal',
        playlist: [],
        playlistIndex: 0,
        shuffleActive: false,
        repeatActive: false,
        isSeeking: false,
        lastVolume: 0.5,

simState: { tip: 'off', depth: 'off', seal: 'off' },
            tipOptions: ['off', 'foam', 'narrow', 'wide', 'double', 'triple'],
            depthOptions: ['off', 'shallow', 'medium', 'deep'],
            sealOptions: ['off', 'good', 'loose', 'broken'],

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

            crossoverActive: false,
            crossoverType: '3way',
            crossoverFreq1: 80,
            crossoverFreq2: 350,
            crossoverFreq3: 3000,
            crossoverFreq4: 8000,
            crossoverLowTrim: 0,
            crossoverLowMidTrim: 0,
            crossoverMidTrim: 0,
            crossoverHighMidTrim: 0,
            crossoverHighTrim: 0,

vizModalActive: false,
        vizModeIndex: 4,
            vizModes: [
                'horizontalSpectrogram', 'fullScreenWaterfall', 'acousticTunnel', 'oledSpectrum', 'oscilloscope', 'audioMesh'
            ],
            fullscreenVizCanvas: null,
            fullscreenVizCtx: null,

            presetsByCategory: {
         music: [
             { id: 'balanced', name: '⚖️ Balanced' }, { id: 'harman', name: '🎧 Harman' },
             { id: 'vshape', name: '🔺 V-Shape' }, { id: 'warm', name: '🌿 Warm' },
             { id: 'vocal_music', name: '🎤 Vocal' }, { id: 'rock', name: '🎸 Rock' },
             { id: 'edm', name: '🎛️ EDM' }, { id: 'hiphop', name: '🎤 Hip-Hop' },
             { id: 'jazz', name: '🎺 Jazz' }, { id: 'classical', name: '🎻 Classical' },
             { id: 'metal', name: '🤘 Metal' }, { id: 'acoustic', name: '🎹 Acoustic' },
             { id: 'rnb', name: '🎷 R&B' }, { id: 'pop', name: '🎹 Pop' },
             { id: 'lofi', name: '☕ Lo-Fi' }, { id: 'reggae', name: '🍁 Reggae' },
             { id: 'funk', name: '🕶️ Funk' }, { id: 'synthwave', name: '🛸 Synthwave' },
             { id: 'disco', name: '🪩 Disco' }, { id: 'orchestra', name: '🎼 Orchestra' },
             { id: 'indie', name: '🎸 Indie' }, { id: 'kpop', name: '🎤 K-Pop' }
         ],
         gaming: [
             { id: 'fps', name: '🎮 Footsteps' }, { id: 'competitive', name: '🔫 Competitive' },
             { id: 'footsteps', name: '👣 Steps' }, { id: 'immersive', name: '🌍 Immersive' },
             { id: 'gaming_imaging', name: '🎯 Positional' }, { id: 'story', name: '🎬 Story' },
             { id: 'rpg', name: '🗣️ RPG' }, { id: 'racing', name: '🏎️ Racing' },
             { id: 'retro', name: '🕹️ Arcade' }, { id: 'stealth', name: '🥷 Stealth' },
             { id: 'scifi', name: '🚀 Sci-Fi' }, { id: 'horror', name: '🧟 Horror' },
             { id: 'sniper', name: '🔭 Sniper' }, { id: 'tactical', name: '💣 Tactical' },
             { id: 'cyberpunk', name: '🦾 Cyberpunk' }, { id: 'arena', name: '⚔️ Arena' },
             { id: 'survival', name: '🩻 Wasteland' }, { id: 'rhythm', name: '🥁 Rhythm' },
             { id: 'flight', name: '🛩️ Flight' }, { id: 'moba', name: '🛡️ MOBA' },
             { id: 'sims', name: '🏡 Casual' }, { id: 'fighting', name: '🥊 Fighting' }
         ],
         media: [
             { id: 'cinema', name: '🎥 Cinema' }, { id: 'dialogue', name: '📢 Dialogue' },
             { id: 'podcast', name: '🎙️ Podcast' }, { id: 'audiobook', name: '📚 Audiobook' },
             { id: 'shows', name: '📺 Television' }, { id: 'movie', name: '🍿 Movies' },
             { id: 'sports', name: '🏟️ Sports' }, { id: 'vintage', name: '🎞️ Vintage' },
             { id: 'documentary', name: '📽️ Documentary' }, { id: 'anime', name: '🎤 Anime' },
             { id: 'asmr', name: '🎐 ASMR' }, { id: 'radio', name: '📻 Broadcast' },
             { id: 'news', name: '📰 News' }, { id: 'thriller', name: '⚡ Thriller' },
             { id: 'comedy', name: '🎪 Comedy' }, { id: 'theater', name: '🏛️ Theater' },
             { id: 'vlog', name: '🤳 Vlog' }, { id: 'action', name: '🧨 Blockbuster' },
             { id: 'nature', name: '🏕️ Nature' }, { id: 'whisper', name: '🤫 Whisper' },
             { id: 'sitcom', name: '🛋️ Sitcom' }, { id: 'streaming', name: '🎞️ Stream' }
         ],
         audiophile: [
             { id: 'flat', name: '📏 Flat' }, { id: 'reference', name: '🎯 Studio' },
             { id: 'analytical', name: '🔬 Analytical' }, { id: 'detail', name: '🧠 Detail' },
             { id: 'airy', name: '☁️ Airy' }, { id: 'soundstage', name: '🌌 Soundstage' },
             { id: 'natural', name: '🎼 Natural' }, { id: 'transparent', name: '🪞 Transparent' },
             { id: 'critlistening', name: '🎧 Critical' }, { id: 'diffuse', name: '🌐 Diffuse' },
             { id: 'freefield', name: '📐 Free-Field' }, { id: 'tube', name: '🕯️ Tube' },
             { id: 'mastering', name: '🎚️ Mastering' }, { id: 'binaural', name: '👥 Binaural' },
             { id: 'purist', name: '🕊️ Purist' }, { id: 'holographic', name: '🔮 Holographic' },
             { id: 'coherence', name: '🧬 Phase' }, { id: 'organic', name: '🍃 Organic' },
             { id: 'resolution', name: '🔍 Resolution' }, { id: 'linear', name: '🏁 Linear' },
             { id: 'field', name: '🌲 Field' }, { id: 'booth', name: '🚪 Booth' }
         ],
         basshead: [
             { id: 'bass', name: '🥁 Basshead' }, { id: 'subbass', name: '🌋 Sub-Bass' },
             { id: 'punchy', name: '🥊 Slam' }, { id: 'slam', name: '🏎️ Kinetic' },
             { id: 'extremebass', name: '💥 Megabass' }, { id: 'club', name: '🔈 Club' },
             { id: 'pressure', name: '🌪️ Pressure' }, { id: 'rumble', name: '🌊 Rumble' },
             { id: 'subwoofer', name: '🛞 Subwoofer' }, { id: 'tectonic', name: '🧱 Tectonic' },
             { id: 'impact', name: '🧨 Impact' }, { id: 'techno', name: '🏭 Techno' },
             { id: 'anvil', name: '⛓️ Anvil' }, { id: 'crusher', name: '🚜 Crusher' },
             { id: 'quake', name: '🪨 Quake' }, { id: 'vortex', name: '🕳️ Vortex' },
             { id: 'carnage', name: '👹 Carnage' }, { id: 'piston', name: '⚙️ Piston' },
             { id: 'detonation', name: '💣 Detonation' }, { id: 'rave', name: '🕶️ Rave' },
             { id: 'hammer', name: '🔨 Hammer' }, { id: 'thunder', name: '⚡ Thunder' }
         ]
     },

        eqPresets: null,

        audioEl: null, source: null, preampNode: null, filters: [], advFilters: [], offlineCtx: null, mathFilters: [], eqEnabled: true, preventClipping: false, connected: false, graphBuilt: false,
        vizIndex: 0, vizMode: 'waveform',
        // Same headroom-tracking pattern as _hearingMaxBoost/_loudnessMaxBoost
        // (see updatePreamp/effectivePreampDb) -- the master Bass/Treble
        // shelves apply raw gain through the same worklet sim bank as
        // hearing-cal and the loudness compensator, but had no equivalent
        // preamp pull-back, so a +8dB shelf boost got none of the headroom
        // protection the other two boost sources already receive.
        _masterToneMaxBoost: 0,
        initDOMCache: function() {
            this.preampSliderEl = document.getElementById("eq-preampSlider");
            this.preampValEl = document.getElementById("eq-preampVal");
            this.eqToggleBtnEl = document.getElementById("eqToggleBtn");
            this.masterBassSliderEl = document.getElementById("eq-masterBass");
            this.masterTrebleSliderEl = document.getElementById("eq-masterTreble");
        },
        allocateResponseBuffers: function(numPoints = 150) {
            this.cachedResponseFreqs = new Float32Array(numPoints);
            this.cachedResponseFilterMag = new Float32Array(numPoints);
            this.cachedResponseMagRes = new Float32Array(numPoints);
            this.cachedResponsePhaseRes = new Float32Array(numPoints);
            const minF = 20, maxF = 20000;
            for(let i = 0; i < numPoints; i++) {
                this.cachedResponseFreqs[i] = minF * Math.pow(maxF / minF, i / (numPoints - 1));
            }
        },

        dragTarget: null, isDragging: false, hoverTarget: null, cvsW: 0, cvsH: 0, drawPending: false,
        particleArray: [], simFilters: [],
        cachedSquigFreqs: null,
        cachedSquigFilterMag: null,
        cachedSquigMagRes: null,
        cachedSquigPhaseRes: null,
        lastMinF: 0,
        lastMaxF: 0,

        init: function() {
            const self = this;
            this.eqPresets = JSON.parse('{"balanced":{"p":0,"m":[0,0,0,0,0,0,0,0,0,0],"a":[0,0,0,0,0,0,0,0,0,0]},"warm":{"p":-1,"m":[0,1.5,3,2,0,0,-1,-1.5,-2,0],"a":[1,2,3.5,2.5,0,0,0,-1,-2,0]},"vshape":{"p":-6.0,"m":[4,4.5,2,-1.5,-2,-1,1.5,3.5,4.5,2],"a":[5,4,1.5,-1,-2,-1,2,4,3,1]},"harman":{"p":-5.0,"m":[2,4.5,3,1,-0.5,-1,1.5,4.5,3.5,-1],"a":[3,4.5,2.5,0.5,-0.5,-1,1,3.5,3,0]},"rock":{"p":-3.0,"m":[3,2.5,1.5,-1,0.5,1,2,2.5,1.5,0],"a":[2,3,1.5,0,0.5,1,1.5,2,1.5,0]},"edm":{"p":-6.5,"m":[5,4,2.5,-1,-1.5,-0.5,1.5,3.5,4,2],"a":[6,4,1.5,-1,-1.5,0,2,3,3.5,1]},"hiphop":{"p":-2.5,"m":[2,4.5,3,1,-0.5,-1,1.5,4.5,3.5,-1],"a":[3,4.5,2.5,0.5,-0.5,-1,1,3.5,3,0]},"classical":{"p":-1.5,"m":[-1.5,-1,0.5,1,1.5,2,2.5,3,2.5,1.5],"a":[-2,-1,0.5,1.5,2,1.5,2,2.5,2,1]},"acoustic":{"p":-1.5,"m":[0.5,1,1.5,2.5,3,2.5,2,1.5,1,0.5],"a":[0,1,2,3,2.5,2,1.5,1,0.5,0]},"orchestra":{"p":-1.5,"m":[-1,-0.5,1,2,2.5,2.5,3,2.5,2,1],"a":[-1,0,1.5,2,2.5,2,2.5,2,1.5,0.5]},"relaxed":{"p":1,"m":[1.5,1.5,1,0,-1.5,-2,-2.5,-3,-2,-1],"a":[2,1.5,0.5,-0.5,-1.5,-2,-2,-2,-1,0]},"party":{"p":-2.5,"m":[4.5,4,2,-0.5,-1,0.5,2.5,4,3,1.5],"a":[5,4,1.5,0,-0.5,1,2,3,2.5,1]},"fps":{"p":-2,"m":[-4,-4,-2,0,0,1,2,3,1.5,0],"a":[-5,-3,0,0,1,1.5,4,2,1,0]},"competitive":{"p":-2.5,"m":[-5,-3,-1,1.5,2,2.5,3.5,4.5,2,0.5],"a":[-6,-4,0,1,2,3,4,3,1.5,0]},"footsteps":{"p":-2,"m":[-6,-4,-1,2.5,3.5,4,2.5,1,0,0],"a":[-7,-5,0,2.5,4,3,2,0.5,0,0]},"immersive":{"p":-2,"m":[4,3.5,1.5,0,-1,0,1,2,3,4],"a":[5,4,2,0,-1,0,1.5,2,2.5,3]},"gaming_imaging":{"p":-1.5,"m":[-2,-1,0,1.5,2,2.5,3,2.5,1.5,1],"a":[-2,-1,0,1,2,2.5,3,2,1,0.5]},"precision":{"p":-2,"m":[-3,-2,0,1.5,2.5,3,3.5,2.5,1.5,1],"a":[-3,-1,0.5,1.5,2.5,2.5,3,2,1,0.5]},"storymode":{"p":-2,"m":[3,3,1.5,0,0.5,1,1.5,2.5,3,2],"a":[4,3,1,0,0.5,1,2,2.5,2,1]},"casualgaming":{"p":-1,"m":[1.5,1.5,1,0.5,0.5,1,1.5,2,1.5,1],"a":[2,1.5,1,0.5,0.5,1,1.5,1.5,1,0.5]},"cinema":{"p":-2.5,"m":[4.5,3.5,1.5,-0.5,-1,0.5,2,3.5,4,2.5],"a":[5,3.5,1,-0.5,-1,1,2.5,3,3,2]},"dialogue":{"p":0,"m":[-6,-4,-2,1.5,3,3.5,2,0,-2,-5],"a":[-8,-5,-2,2,3.5,3,1.5,0,-1.5,-4]},"tvshows":{"p":-1,"m":[-2,-1,0.5,1,2,2,1.5,1,0.5,0],"a":[-2,-1,0.5,1.5,2,1.5,1,0.5,0,0]},"podcast":{"p":0,"m":[-5,-3,-1,1.5,3,3,1.5,0.5,-1,-3],"a":[-6,-4,-1,2,3,2.5,1,0.5,-0.5,-2]},"audiobook":{"p":0,"m":[-6,-4,-1,2,3.5,3,1,0.5,-2,-4],"a":[-7,-5,-1,2.5,3.5,2.5,1,0.5,-1,-3]},"streaming":{"p":-1.5,"m":[2,2,1,0.5,0.5,1,1.5,2.5,3,1.5],"a":[3,2,1,0.5,0.5,1,1.5,2,2,1]},"movienight":{"p":-2,"m":[4,3,1,0,-0.5,0.5,1.5,3,3,1.5],"a":[5,3.5,1,0,-0.5,0.5,2,2.5,2,1]},"analytical":{"p":0,"m":[-1.5,-1,-0.5,0,0.5,1,1.5,2,1,0.5],"a":[-2,-1,-0.5,0,0.5,1,1.5,1.5,1,0.5]},"detail":{"p":-1,"m":[0,0,0,0,0,1,2.5,3.5,2,0],"a":[0,0,0,0,0,1.5,4,2,2,1]},"airy":{"p":-1.5,"m":[0,0,0,0,0,0.5,1.5,3,4.5,3.5],"a":[0,0,0,0,0,0,1,3,4,2.5]},"soundstage":{"p":-2,"m":[1,1,0.5,0,-0.5,0.5,1.5,3.5,4,5],"a":[1,1,0.5,0,-0.5,0.5,1.5,3,3.5,4.5]},"audiophile_imaging":{"p":-1.5,"m":[-1,-0.5,0,1,1.5,2,2.5,3,2,1],"a":[-1,-0.5,0,1,1.5,2,2,2,1.5,1]},"reference":{"p":0,"m":[0,0,0,0,0,0.5,0.5,0,0,0],"a":[0,0,0,0,0,0,0,0,0,0]},"natural":{"p":-1,"m":[1,1,1.5,1.5,1,0.5,1,1.5,1,0.5],"a":[1,1,1,1.5,1,0.5,0.5,1,0.5,0]},"timbre":{"p":-1,"m":[0.5,1,1.5,1,0.5,1,1.5,2,1,0.5],"a":[0.5,1,1,1,0.5,1,1,1.5,1,0.5]},"transparent":{"p":-1,"m":[-1,-0.5,0.5,1,1.5,2,2.5,3,2,1.5],"a":[-1,-0.5,0.5,1,1.5,1.5,2,2.5,1.5,1]},"critlistening":{"p":-0.5,"m":[0,0,0,0.5,0.5,0.5,1,1,0.5,0],"a":[0,0,0,0.5,0.5,0.5,0.5,0.5,0.5,0]},"bass":{"p":-5.5,"m":[9.0,8.5,6.0,2.5,0,-1,-1.5,-1,-0.5,0],"a":[10.0,8.0,4.5,1.5,0,0,0,0,0,0]},"subbass":{"p":-3,"m":[6,5.5,3.5,1,0,0,0,0,0,0],"a":[7,5.5,2,0,0,0,0,0,0,0]},"punchy":{"p":-2,"m":[2,4.5,5.5,3.5,1,0,0,0,0,0],"a":[3,5,4,1.5,0,0,0,0,0,0]},"caraudio":{"p":-3.5,"m":[6.5,5.5,4,2,0.5,-0.5,1,2.5,3.5,1.5],"a":[7,6,3,1.5,0,-0.5,1,2,2.5,1]},"bass_party":{"p":-3,"m":[5.5,5,3.5,1,-0.5,0.5,2,3,3,1],"a":[6,5,3,1,-0.5,0.5,1.5,2,2,0.5]},"slam":{"p":-3,"m":[4,5.5,6,4,1.5,0.5,1.5,3,3.5,1.5],"a":[4.5,6,4.5,2,1,0.5,1,2,2.5,1]},"extremebass":{"p":-5,"m":[9,8.5,6.5,4,1.5,0,0,0.5,1.5,1],"a":[10,8.5,5,2.5,1,0,0,0,1,1]},"club":{"p":-3,"m":[5,5,4.5,2.5,1,0.5,1.5,2.5,2,1],"a":[5,5,4.5,2.5,1,0.5,1.5,2.5,2,1]},"bassboost":{"p":-2.5,"m":[4.5,3.5,1.5,0,0,0,0,0,0,0],"a":[5.0,3.0,0.5,0,0,0,0,0,0,0]},"deeprumble":{"p":-2,"m":[5.5,4.0,2.0,0.5,0,0,0,0,0,0],"a":[6,4,1.5,0,0,0,0,0,0,0]},"rpg":{"p":-1.5,"m":[1.5,1,0.5,0,0.5,1.5,2,2.5,2,1],"a":[2,1.5,0.5,0,0.5,1,1.5,2,1.5,1]},"racing":{"p":-2,"m":[3,3.5,2,0.5,-1,-0.5,1,2.5,2,1],"a":[3,3.5,1.5,0,-0.5,0.5,1.5,2,1.5,1]},"retro":{"p":-1,"m":[-2,-1,0.5,2,2.5,2,1.5,1,0.5,-1],"a":[-3,-1,1,2,2.5,2,1.5,1,0,-2]},"stealth":{"p":-2,"m":[-4,-3,-1,1.5,2,2.5,3.5,4,2.5,1],"a":[-5,-3,0,1,2.5,3,3.5,2.5,1.5,0.5]},"chill":{"p":-1,"m":[2,2.5,1.5,0.5,-0.5,-1,-1.5,-2,-1,0],"a":[3,2.5,1,0,-0.5,-1,-1,-1.5,-1,0]},"sports":{"p":-1.5,"m":[1,2,2.5,1,0,0.5,1.5,2,1,0],"a":[1,2,2,0.5,0,0.5,1,1.5,1,0]},"vintage":{"p":-1,"m":[0.5,1.5,2,2.5,2,1.5,1,0,-2,-4],"a":[1,2,2,2.5,1.5,1,0.5,0,-1,-3]},"documentary":{"p":0,"m":[-3,-1,0.5,1.5,2.5,3,2,1,0,-2],"a":[-4,-2,0,1,2,2.5,1.5,1,0,-1]},"anime":{"p":-1.5,"m":[1,2.5,2,0.5,1,2,2.5,3,2,1],"a":[1,2.5,1.5,0.5,1,1.5,2,2.5,1.5,0.5]},"vocals":{"p":-1,"m":[-2,-1,0.5,1.5,2.5,3.5,3,2,1,0.5],"a":[-2,-1,0.5,2,3,3,2,1.5,1,0.5]},"flat":{"p":0,"m":[0,0,0,0,0,0,0,0,0,0],"a":[0,0,0,0,0,0,0,0,0,0]},"bass_cannon":{"p":-4,"m":[7,7,5.5,3,1,0,0,0,0,0],"a":[8,7,4.5,2,0.5,0,0,0,0,0]},"shaker":{"p":-3.5,"m":[5,6,4.5,2,0.5,0,0,0,1,2],"a":[6,6,3.5,1.5,0,0,0,0,1,1.5]}}');

            const curatedPresets = {

                "balanced": { "p": 0.0, "m": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                "harman": { "p": -5.0, "m": [5.0, 4.5, 2.5, 0.5, -0.5, 0.0, 1.5, 4.0, 1.5, -1.0] },
                "vshape": { "p": -4.5, "m": [4.5, 4.0, 2.0, -1.5, -2.0, -1.0, 1.5, 3.5, 4.5, 3.0] },
                "warm": { "p": -3.0, "m": [3.0, 3.5, 2.5, 1.0, 0.5, 0.0, -0.5, -1.0, -2.0, -2.5] },
                "vocal_music": { "p": -3.5, "m": [-3.0, -1.5, 0.5, 1.5, 2.5, 3.5, 4.0, 2.5, 1.0, 0.5] },
                "rock": { "p": -3.0, "m": [3.0, 2.5, 1.5, -1.0, 0.5, 1.0, 2.0, 2.5, 1.5, 0.0] },
                "edm": { "p": -6.0, "m": [6.0, 4.5, 2.0, -1.0, -1.5, 0.0, 1.5, 3.5, 4.0, 2.5] },
                "hiphop": { "p": -5.5, "m": [5.5, 5.0, 3.0, 1.0, -0.5, 0.0, 1.0, 2.0, 2.5, 1.0] },
                "jazz": { "p": -2.5, "m": [1.0, 2.0, 2.5, 1.5, 0.5, 0.0, 0.5, 1.5, 2.0, 1.0] },
                "classical": { "p": -2.0, "m": [-1.0, -0.5, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 2.5, 1.5] },
                "metal": { "p": -3.0, "m": [2.5, 2.0, -0.5, -1.5, 0.0, 1.0, 2.0, 3.0, 2.0, 0.5] },
                "acoustic": { "p": -2.5, "m": [0.5, 1.5, 2.0, 2.5, 2.0, 1.5, 1.0, 1.5, 1.0, 0.5] },
                "rnb": { "p": -3.5, "m": [3.5, 4.0, 2.5, 1.0, 0.5, 1.0, 2.0, 2.5, 1.5, 0.5] },
                "pop": { "p": -3.5, "m": [3.0, 4.0, 2.0, 0.0, -0.5, 0.5, 1.5, 3.0, 2.5, 1.0] },
                "lofi": { "p": -2.5, "m": [2.0, 3.0, 1.5, 0.0, 0.5, 1.0, 0.0, -1.5, -3.0, -4.5] },
                "reggae": { "p": -4.5, "m": [6.5, 5.5, 3.0, 0.5, 0.0, 0.5, 1.0, 1.5, 0.5, 0.0] },
                "funk": { "p": -3.0, "m": [2.0, 3.5, 2.0, -1.0, 0.0, 1.0, 2.0, 2.5, 1.5, 0.5] },
                "synthwave": { "p": -4.0, "m": [4.0, 3.5, 1.5, 0.0, -1.0, 0.5, 1.5, 2.5, 2.0, 1.5] },
                "disco": { "p": -3.0, "m": [3.0, 2.5, 1.0, -1.0, -1.5, 0.0, 1.0, 2.0, 3.0, 2.0] },
                "orchestra": { "p": -2.0, "m": [-1.0, -0.5, 1.0, 2.0, 2.5, 2.5, 3.0, 2.5, 2.0, 1.0] },
                "indie": { "p": -3.0, "m": [2.0, 2.5, 1.5, 0.5, 1.0, 2.0, 2.5, 2.0, 1.0, 0.5] },
                "kpop": { "p": -4.0, "m": [3.5, 4.0, 2.0, -0.5, 0.0, 1.0, 2.5, 3.5, 3.0, 2.0] },

                "fps": { "p": -4.5, "m": [-6.0, -5.0, -1.0, 2.5, 3.5, 4.0, 4.5, 3.0, 1.0, 0.0] },
                "competitive": { "p": -4.0, "m": [-5.0, -3.0, 0.0, 1.5, 2.5, 3.5, 4.0, 2.5, 1.0, 0.0] },
                "footsteps": { "p": -4.0, "m": [-7.0, -4.0, 1.0, 3.5, 4.0, 3.5, 3.0, 1.5, 0.0, 0.0] },
                "immersive": { "p": -4.0, "m": [4.0, 3.5, 1.5, 0.0, -1.0, 0.0, 1.5, 2.5, 3.0, 3.5] },
                "gaming_imaging": { "p": -3.0, "m": [-2.0, -1.0, 0.0, 1.5, 2.0, 2.5, 3.0, 2.5, 1.5, 1.0] },
                "story": { "p": -3.0, "m": [2.0, 2.5, 1.5, 0.5, 0.5, 1.5, 2.0, 2.5, 2.0, 1.0] },
                "rpg": { "p": -2.5, "m": [1.5, 1.0, 0.5, 0.5, 1.0, 2.0, 2.5, 2.0, 1.5, 1.0] },
                "racing": { "p": -3.5, "m": [3.5, 3.5, 2.0, 0.5, -1.0, -0.5, 1.0, 2.5, 2.0, 1.0] },
                "retro": { "p": -2.5, "m": [-3.0, -1.0, 1.0, 2.0, 2.5, 2.0, 1.5, 1.0, 0.0, -2.0] },
                "stealth": { "p": -4.0, "m": [-5.0, -3.0, 0.0, 1.0, 2.5, 3.0, 4.0, 3.0, 1.5, 0.5] },
                "scifi": { "p": -3.5, "m": [3.0, 2.0, 0.5, -1.0, -1.5, 0.5, 1.5, 3.0, 3.5, 2.5] },
                "horror": { "p": -4.5, "m": [4.5, 3.0, 1.0, 0.0, 1.0, 2.0, 3.0, 3.5, 2.5, 1.5] },
                "sniper": { "p": -4.0, "m": [-6.0, -4.0, 0.0, 1.5, 2.5, 3.5, 4.5, 3.0, 1.0, 0.0] },
                "tactical": { "p": -3.5, "m": [-4.0, -2.0, 0.0, 1.0, 2.0, 2.5, 3.5, 2.5, 1.0, 0.0] },
                "cyberpunk": { "p": -4.0, "m": [4.5, 3.5, 1.5, -1.0, -1.5, 0.5, 2.0, 3.0, 4.0, 2.5] },
                "arena": { "p": -3.0, "m": [-2.0, -1.0, 0.5, 1.5, 2.5, 2.0, 1.0, 0.5, 0.0, 0.0] },
                "survival": { "p": -4.0, "m": [-7.0, -5.0, -1.0, 2.5, 3.5, 3.0, 2.0, 1.0, 1.5, 2.0] },
                "rhythm": { "p": -3.0, "m": [1.5, 3.5, 4.0, 2.5, 1.0, 0.5, 1.0, 1.5, 1.0, 0.5] },
                "flight": { "p": -3.5, "m": [3.0, 2.5, 1.0, 0.0, -0.5, 0.5, 1.5, 2.5, 2.0, 1.0] },
                "moba": { "p": -2.5, "m": [-3.0, -1.5, 0.5, 1.5, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0] },
                "sims": { "p": -2.0, "m": [1.5, 1.5, 1.0, 0.5, 0.5, 1.0, 1.5, 1.5, 1.0, 0.5] },
                "fighting": { "p": -3.5, "m": [3.0, 3.5, 2.5, 1.0, 0.5, 1.0, 2.0, 2.5, 1.5, 0.5] },

                "cinema": { "p": -4.5, "m": [4.5, 3.5, 1.5, -0.5, -1.0, 0.5, 2.0, 3.5, 4.0, 2.5] },
                "dialogue": { "p": -3.5, "m": [-6.0, -4.0, -1.0, 2.0, 3.5, 3.5, 2.5, 1.0, -1.0, -3.0] },
                "podcast": { "p": -3.0, "m": [-5.0, -3.0, -0.5, 1.5, 3.0, 3.0, 1.5, 0.5, -1.0, -3.0] },
                "audiobook": { "p": -3.5, "m": [-6.0, -4.0, -1.0, 2.0, 3.5, 3.0, 1.5, 0.5, -1.0, -3.0] },
                "shows": { "p": -2.5, "m": [-2.0, -1.0, 0.5, 1.5, 2.0, 2.0, 1.5, 1.0, 0.5, 0.0] },
                "movie": { "p": -4.0, "m": [4.0, 3.0, 1.0, 0.0, -0.5, 0.5, 1.5, 3.0, 3.0, 1.5] },
                "sports": { "p": -3.0, "m": [1.0, 2.0, 2.5, 1.0, 0.5, 1.0, 2.0, 3.0, 1.5, 0.5] },
                "vintage": { "p": -2.5, "m": [0.5, 1.5, 2.0, 2.5, 2.0, 1.5, 1.0, 0.0, -2.0, -4.0] },
                "documentary": { "p": -2.5, "m": [-3.0, -1.0, 0.5, 1.5, 2.5, 3.0, 2.0, 1.0, 0.0, -2.0] },
                "anime": { "p": -3.0, "m": [1.0, 2.5, 2.0, 0.5, 1.0, 2.0, 2.5, 3.0, 2.0, 1.0] },
                "asmr": { "p": -4.5, "m": [-6.0, -4.0, -2.0, 0.0, 1.0, 2.0, 3.5, 4.5, 4.5, 3.0] },
                "radio": { "p": -4.0, "m": [-10.0, -8.0, -2.0, 2.0, 4.0, 3.0, 1.0, -2.0, -6.0, -10.0] },
                "news": { "p": -3.0, "m": [-5.0, -3.0, 0.0, 2.0, 3.5, 3.5, 2.0, 0.5, -1.0, -3.0] },
                "thriller": { "p": -4.0, "m": [3.5, 4.0, 2.0, 0.0, 0.5, 1.0, 2.0, 3.0, 2.5, 1.5] },
                "comedy": { "p": -2.5, "m": [1.5, 2.5, 2.0, 0.5, 0.0, 0.5, 1.5, 2.5, 2.0, 1.0] },
                "theater": { "p": -3.5, "m": [4.0, 3.0, 1.5, -0.5, -1.0, 0.5, 2.0, 3.0, 3.5, 4.0] },
                "vlog": { "p": -2.5, "m": [-3.0, -2.0, -1.0, 1.0, 2.0, 2.5, 1.5, 0.5, 0.0, 0.0] },
                "action": { "p": -4.5, "m": [5.0, 4.0, 2.0, 0.0, -1.0, 0.5, 2.0, 3.5, 4.0, 3.0] },
                "nature": { "p": -2.5, "m": [1.0, 2.0, 2.5, 1.5, 1.0, 0.5, 1.0, 1.5, 1.0, 0.5] },
                "whisper": { "p": -4.0, "m": [-8.0, -6.0, -4.0, -1.0, 1.5, 2.5, 3.5, 4.5, 5.0, 5.0] },
                "sitcom": { "p": -2.0, "m": [-2.0, -1.0, 1.0, 2.0, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0] },
                "streaming": { "p": -3.0, "m": [2.0, 2.0, 1.0, 0.5, 0.5, 1.0, 1.5, 2.5, 2.0, 1.0] },

                "flat": { "p": 0.0, "m": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                "reference": { "p": -0.5, "m": [0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.0, 0.0, 0.0] },
                "analytical": { "p": -2.0, "m": [-1.5, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 1.0, 0.5] },
                "detail": { "p": -2.5, "m": [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 2.5, 3.0, 2.0, 1.0] },
                "airy": { "p": -4.5, "m": [0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.0, 4.5, 3.5] },
                "soundstage": { "p": -4.5, "m": [1.5, 1.0, 0.5, 0.0, -0.5, 0.5, 1.5, 3.5, 4.0, 4.5] },
                "natural": { "p": -1.5, "m": [1.0, 1.5, 1.5, 1.0, 0.5, 0.5, 1.0, 1.5, 1.0, 0.5] },
                "transparent": { "p": -2.5, "m": [-1.0, -0.5, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 2.0, 1.5] },
                "critlistening": { "p": -1.0, "m": [0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0, 1.0, 0.5, 0.0] },
                "diffuse": { "p": -5.0, "m": [-3.0, -1.5, 0.5, 1.5, 2.5, 3.5, 5.0, 4.0, 2.0, 1.0] },
                "freefield": { "p": -4.5, "m": [-4.0, -2.5, 0.0, 1.5, 3.5, 4.5, 3.0, 1.5, 0.0, -1.0] },
                "tube": { "p": -2.0, "m": [2.0, 2.0, 1.5, 0.5, 0.0, 0.0, -0.5, -1.0, -1.5, -2.0] },
                "mastering": { "p": -1.0, "m": [-0.5, 0.0, 0.0, 0.5, 0.5, 0.5, 1.0, 0.5, 0.0, 0.0] },
                "binaural": { "p": -2.5, "m": [0.5, 1.0, 1.5, 2.0, 1.5, 1.0, 1.5, 2.0, 1.5, 0.5] },
                "purist": { "p": 0.0, "m": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
                "holographic": { "p": -3.5, "m": [1.0, 1.0, 0.5, 0.0, -0.5, 0.5, 1.5, 3.5, 4.5, 5.5] },
                "coherence": { "p": -1.5, "m": [0.5, 1.0, 1.5, 1.0, 0.5, 1.0, 1.5, 2.0, 1.0, 0.5] },
                "organic": { "p": -2.0, "m": [1.5, 1.5, 2.0, 1.5, 1.0, 0.5, 1.0, 1.5, 1.0, 0.5] },
                "resolution": { "p": -2.5, "m": [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 3.0, 4.0, 2.5, 1.0] },
                "linear": { "p": -0.5, "m": [0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0, 0.0, 0.0] },
                "field": { "p": -2.0, "m": [-1.0, -0.5, 0.0, 0.5, 1.0, 1.0, 1.5, 2.0, 1.5, 1.0] },
                "booth": { "p": -2.0, "m": [-1.5, -0.5, 0.5, 1.5, 2.0, 1.5, 1.0, 0.5, 0.0, 0.0] },

                "bass": { "p": -9.0, "m": [9.0, 8.5, 6.0, 2.5, 0.0, -1.0, -1.5, -1.0, -0.5, 0.0] },
                "subbass": { "p": -7.0, "m": [7.0, 5.5, 3.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "punchy": { "p": -5.5, "m": [2.0, 4.5, 5.5, 3.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "slam": { "p": -6.0, "m": [4.0, 6.0, 5.5, 3.0, 1.0, 0.5, 1.0, 2.0, 2.5, 1.0] },
                "extremebass": { "p": -10.0, "m": [10.0, 9.0, 7.0, 4.0, 1.5, 0.0, 0.0, 0.5, 1.5, 1.0] },
                "club": { "p": -5.0, "m": [5.0, 5.0, 4.5, 2.5, 1.0, 0.5, 1.5, 2.5, 2.0, 1.0] },
                "pressure": { "p": -6.5, "m": [6.5, 5.5, 3.5, 1.5, 0.0, -0.5, -1.0, -0.5, 0.0, 0.5] },
                "rumble": { "p": -5.5, "m": [5.5, 4.0, 2.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "subwoofer": { "p": -9.5, "m": [9.5, 9.0, 6.5, 3.0, 0.5, -1.0, -2.0, -1.5, -1.0, 0.0] },
                "tectonic": { "p": -8.5, "m": [8.5, 7.5, 4.5, 1.0, -1.0, -2.0, -2.0, -1.5, -1.0, 0.0] },
                "impact": { "p": -4.0, "m": [2.0, 4.0, 3.0, 1.0, 0.0, 0.5, 1.5, 2.0, 1.0, 0.0] },
                "techno": { "p": -4.0, "m": [4.0, 4.0, 3.5, 1.5, 0.0, 1.0, 1.5, 2.0, 1.0, 0.0] },
                "anvil": { "p": -5.5, "m": [3.0, 5.5, 6.5, 4.5, 1.5, 0.5, 1.0, 1.5, 1.0, 0.0] },
                "crusher": { "p": -10.0, "m": [10.5, 9.5, 7.0, 4.0, 1.5, 0.0, 0.0, 0.5, 1.0, 1.5] },
                "quake": { "p": -7.5, "m": [7.5, 6.5, 3.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "vortex": { "p": -6.5, "m": [6.5, 6.0, 4.0, 2.0, 0.5, -0.5, -1.0, -1.5, -1.5, -1.0] },
                "carnage": { "p": -9.0, "m": [9.0, 8.5, 7.0, 4.5, 2.0, 0.5, 1.0, 1.5, 2.0, 1.0] },
                "piston": { "p": -5.0, "m": [2.5, 5.0, 4.5, 2.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "detonation": { "p": -6.5, "m": [4.5, 6.5, 5.5, 3.5, 1.0, 0.5, 1.0, 1.5, 1.0, 0.5] },
                "rave": { "p": -5.0, "m": [5.0, 4.5, 2.5, -0.5, -1.5, 0.5, 1.5, 3.0, 3.0, 1.0] },
                "hammer": { "p": -6.5, "m": [2.5, 6.5, 5.5, 3.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0] },
                "thunder": { "p": -8.0, "m": [8.0, 6.5, 3.5, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0] }
            };

            Object.assign(this.eqPresets, curatedPresets);

            this.initDOMCache();
            this.allocateResponseBuffers(150);
            this.injectDynamicPresetsOnLoad();
        this.audioEl = document.getElementById("eq-audio");
        // Gapless/crossfade standby element ("B" arm). Grabbed here so the
        // timeupdate/durationchange listeners below bind at boot; its
        // MediaElementSource + gain arm are created later in _buildDSPGraph.
        this.gaplessEl = document.getElementById("eq-audio-gapless");
        if (!this.audioEl) {
            console.error("[EQ_Module.init] #eq-audio element not found — audio playback wiring skipped.");
        } else {
                this.audioEl.volume = 0.5;
                this.audioEl.preservesPitch = true;

                this.audioEl.addEventListener('volumechange', () => {

                });

                this.audioEl.onplay = async () => {
                    Mascot.update();

                    const btn = document.getElementById("playlist-play-btn");
                    const mobBtn = document.getElementById("mobile-play-btn");
                    if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                    if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                    const modalBtn = document.getElementById("modal-play-btn");
                    if(modalBtn) modalBtn.innerHTML = "<span>⏸</span><span>Pause</span>";

                    if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                        await SharedAudio.ctx.resume();
                    }
                    // On the normal path the MediaElementSource is created once in
                    // ensureDSPGraph() before any playback starts (that's what fixes
                    // the boot-mute). This branch is only a safety net for the rare
                    // case where the graph was built without the element present.
                    if(!this.connected) {
                        await this.ensureDSPGraph();
                        if (!this.source && this.audioEl && SharedAudio.ctx && this.inputGainNode) {
                            this.source = SharedAudio.ctx.createMediaElementSource(this.audioEl);
                            // Route through the same gain arm _buildDSPGraph uses
                            // so per-track loudness match applies on this path too.
                            if (!this.sourceGain) {
                                this.sourceGain = SharedAudio.ctx.createGain();
                                this.sourceGain.gain.value = Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1));
                            }
                            this.source.connect(this.sourceGain);
                            this.sourceGain.connect(this.inputGainNode);
                        }
                        if (this.audioEl) this.audioEl.volume = 1.0;
                        this.connected = true;
                    }

                    if (!this.vizLoopRunning) {
                        this.startVisualizer();
                    }
                };
                this.audioEl.addEventListener('play', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                });
                this.audioEl.addEventListener('pause', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                    // Update play button if both elements are paused (gapless may still be playing)
                    const active = this._activeEl ? this._activeEl() : this.audioEl;
                    const gaplessPaused = !this.gaplessEl || this.gaplessEl.paused;
                    const audioPaused = this.audioEl.paused;
                    if (active && active.paused && gaplessPaused && audioPaused) {
                        const btn = document.getElementById("playlist-play-btn");
                        if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
                        const mobBtn = document.getElementById("mobile-play-btn");
                        if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
                        const modalBtn = document.getElementById("modal-play-btn");
                        if(modalBtn) modalBtn.innerHTML = "<span>▶</span><span>Play</span>";
                    }
                });
                this.audioEl.addEventListener('ended', () => {
                    Mascot.update();
                    EQ_Module.updateReverbDSP();
                    this.nextTrack();
                });
                if (this.gaplessEl) {
                    this.gaplessEl.onplay = async () => {
                        Mascot.update();
                        const btn = document.getElementById("playlist-play-btn");
                        const mobBtn = document.getElementById("mobile-play-btn");
                        if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M6 19h4V5H6v14zm8-14v14h4V5h-4z\"/></svg>";
                        if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">⏸</span>";
                        const modalBtn = document.getElementById("modal-play-btn");
                        if(modalBtn) modalBtn.innerHTML = "<span>⏸</span><span>Pause</span>";
                        if (SharedAudio.ctx && SharedAudio.ctx.state === 'suspended') {
                            await SharedAudio.ctx.resume();
                        }
                        if (!this.vizLoopRunning) {
                            this.startVisualizer();
                        }
                    };
                    this.gaplessEl.addEventListener('play', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                    });
                    this.gaplessEl.addEventListener('pause', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                        const active = this._activeEl ? this._activeEl() : null;
                        if (!active || active.paused) {
                            const btn = document.getElementById("playlist-play-btn");
                            if(btn) btn.innerHTML = "<svg class=\"w-[18px] h-[18px]\" viewBox=\"0 0 24 24\" fill=\"currentColor\"><path d=\"M8 5v14l11-7z\"/></svg>";
                            const mobBtn = document.getElementById("mobile-play-btn");
                            if(mobBtn) mobBtn.innerHTML = "<span class=\"text-[13px] leading-none\">▶</span>";
                            const modalBtn = document.getElementById("modal-play-btn");
                            if(modalBtn) modalBtn.innerHTML = "<span>▶</span><span>Play</span>";
                        }
                    });
                    this.gaplessEl.addEventListener('ended', () => {
                        Mascot.update();
                        EQ_Module.updateReverbDSP();
                        this.nextTrack();
                    });
                }
            }

            const eqFileInput = document.getElementById("eq-file");
            if (!eqFileInput) {
                console.error("[EQ_Module.init] #eq-file element not found — file upload wiring skipped.");
            } else {
                eqFileInput.addEventListener("change", e => {
                    this.handleAudioFileSelection(e.target.files);
                    e.target.value = '';
                });
            }

            const updateScrubDisplay = (activeEl) => {
                if (!activeEl) return;
                const dur = activeEl.duration;
                const cur = activeEl.currentTime;
                if (!this.isSeeking && dur && Number.isFinite(dur) && dur > 0) {
                    const pct = Math.max(0, Math.min(100, (cur / dur) * 100));
                    ['playlist-scrub', 'mobile-scrub', 'modal-scrub'].forEach(id => {
                        const s = document.getElementById(id);
                        if (!s) return;
                        s.value = pct;
                        if (window.paintSliderTrack) window.paintSliderTrack(s);
                        else s.style.setProperty('--range-fill', pct + '%');
                    });
                }
                const formatted = this.formatTime(cur || 0);
                const timeCur = document.getElementById('playlist-time-current');
                const mobTimeCur = document.getElementById('mobile-time-current');
                const modalTimeCur = document.getElementById('modal-time-current');
                if (timeCur) timeCur.textContent = formatted;
                if (mobTimeCur) mobTimeCur.textContent = formatted;
                if (modalTimeCur) modalTimeCur.textContent = formatted;
            };

            const attachTimeUpdate = (el) => {
                if (!el) return;
                el.addEventListener('timeupdate', () => updateScrubDisplay(el));
                el.addEventListener('canplay', () => updateScrubDisplay(el));
                el.addEventListener('loadeddata', () => updateScrubDisplay(el));
                el.addEventListener('durationchange', () => {
                    const dur = el.duration;
                    if (dur && Number.isFinite(dur) && dur > 0) {
                        const formatted = this.formatTime(dur);
                        const timeDur = document.getElementById('playlist-time-duration');
                        const mobTimeDur = document.getElementById('mobile-time-duration');
                        const modalTimeDur = document.getElementById('modal-time-duration');
                        if (timeDur) timeDur.textContent = formatted;
                        if (mobTimeDur) mobTimeDur.textContent = formatted;
                        if (modalTimeDur) modalTimeDur.textContent = formatted;
                    }
                });
            };

            attachTimeUpdate(this.audioEl);
            if (this.gaplessEl) attachTimeUpdate(this.gaplessEl);

            const scrub = document.getElementById('playlist-scrub');
            const mobScrub = document.getElementById('mobile-scrub');
            const modalScrub = document.getElementById('modal-scrub');

            const startSeek = () => {
                this.isSeeking = true;
            };

            const bindScrubEvents = (el) => {
                if (!el) return;
                el.addEventListener('mousedown', startSeek);
                el.addEventListener('touchstart', startSeek, { passive: true });

                let scrubFlushPending = false;
                el.addEventListener('input', () => {
                    this.isSeeking = true;
                    if (scrubFlushPending) return;
                    scrubFlushPending = true;
                    requestAnimationFrame(() => {
                        scrubFlushPending = false;
                        const val = parseFloat(el.value) || 0;
                        if (window.paintSliderTrack) window.paintSliderTrack(el);
                        else el.style.setProperty('--range-fill', val + '%');

                        const active = (this._activeEl && this._activeEl()) || this.audioEl;
                        if (active && active.duration) {
                            const tempTime = (val / 100) * active.duration;
                            const formatted = this.formatTime(tempTime);
                            const timeCur = document.getElementById('playlist-time-current');
                            const mobTimeCur = document.getElementById('mobile-time-current');
                            const modalTimeCur = document.getElementById('modal-time-current');
                            if (timeCur) timeCur.textContent = formatted;
                            if (mobTimeCur) mobTimeCur.textContent = formatted;
                            if (modalTimeCur) modalTimeCur.textContent = formatted;
                        }
                    });
                });

                el.addEventListener('change', () => {
                    const val = parseFloat(el.value) || 0;
                    const active = (this._activeEl && this._activeEl()) || this.audioEl;
                    if (active && active.duration) {
                        const targetTime = (val / 100) * active.duration;
                        // performCleanSeek owns isSeeking until the media
                        // element actually reports the new position.
                        this.performCleanSeek(targetTime, val);
                    } else {
                        setTimeout(() => { this.isSeeking = false; }, 100);
                    }
                });
            };

            bindScrubEvents(scrub);
            bindScrubEvents(mobScrub);
            bindScrubEvents(modalScrub);

            window.addEventListener('mouseup', () => { this.isSeeking = false; });
            window.addEventListener('touchend', () => { this.isSeeking = false; });

            // rAF scrub ticker: timeupdate only fires ~4x/sec, which made the
            // thumb crawl in visible 250ms steps. Paint per-frame instead;
            // skipped entirely while paused, seeking, or dragging.
            if (this._scrubRaf) cancelAnimationFrame(this._scrubRaf);
            let _scrubStuckWarn = 0;
            const paintPlaybackScrub = () => {
                this._scrubRaf = requestAnimationFrame(paintPlaybackScrub);
                if (this.isSeeking) return;
                const active = (this._activeEl && this._activeEl()) || this.audioEl;
                if (!active || active.paused) return;
                // Wait until the audio has loaded enough data to report
                // a non-zero currentTime before overriding the scrub.
                // updateScrubDisplay (via timeupdate) handles the interim.
                if (!active.duration || !Number.isFinite(active.duration) || active.readyState < 2) return;
                _scrubStuckWarn = 0;
                const pct = Math.max(0, Math.min(100, (active.currentTime / active.duration) * 100));
                ['playlist-scrub', 'mobile-scrub', 'modal-scrub'].forEach(id => {
                    const s = document.getElementById(id);
                    if (!s) return;
                    if (Math.abs(parseFloat(s.value) - pct) < 0.05) return;
                    s.value = pct;
                    if (window.paintSliderTrack) window.paintSliderTrack(s);
                    else s.style.setProperty('--range-fill', pct + '%');
                });
            };
            paintPlaybackScrub();

            const MathCtx = window.AudioContext || window.webkitAudioContext;
            const activeSampleRate = (window.SharedAudio && SharedAudio.ctx) ? SharedAudio.ctx.sampleRate : 44100;
            this.offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, activeSampleRate);

            // Idempotency guard: re-running init (boot retry, diagnostics) must
            // not push a second set of 70 biquads and desync every mathFilters
            // index from the band slots.
            if (this.mathFilters.length === 0) {
                for(let i = 0; i < 70; i++) {
                    this.mathFilters.push(this.offlineCtx.createBiquadFilter());
                }
            }

        this.buildEQ();

        // Sync the master toggle to the real state at boot: eqEnabled defaults
        // to true, so the button must read "EQ: ON" with .is-on applied. This
        // guards against HTML/JS drift and any stale markup.
        const eqToggleSyncBtn = document.getElementById("eqToggleBtn");
        if (eqToggleSyncBtn) {
            eqToggleSyncBtn.classList.toggle('is-on', !!this.eqEnabled);
            eqToggleSyncBtn.textContent = this.eqEnabled ? "EQ: ON" : "EQ: OFF";
        }

        this.togglePersonalityMode('simple');
        this.switchGraphViewport('squig');
        this.updatePreventClippingUI();

        this.switchAcousticsSubTab('coupling');

        window.addEventListener('resize', () => this.drawCurve());

            const squigCanvas = document.getElementById("eq-squiglinkViz");
            if (squigCanvas) {
                let isPanning = false;
                let isDraggingSculptNode = false;
                let isDraggingEQNode = false;
                let panStartX = 0;
                let panStartY = 0;
                let lastMinF = 20;
                let lastMaxF = 20000;

            const getEQNodeAtCoords = (clickX, clickY, w, h, minF, maxF, min, max) => {
                const alignDb = (typeof PEQDB_Module.alignDb === 'number') ? PEQDB_Module.alignDb : 75.0;
                const preSlider = document.getElementById("eq-preampSlider");
                const preVal = preSlider ? parseFloat(preSlider.value) : 0;

                for (let i = 0; i < EQ_Module.bands.length; i++) {
                    const hz = parseFloat(document.getElementById("eq-f" + i)?.value || EQ_Module.bands[i].hz);
                    const g = parseFloat(document.getElementById("eq-s" + i)?.value || 0);
                    const nodeX = w * (Math.log10(hz / minF) / Math.log10(maxF / minF));

                    const nodeY = h - (((alignDb + g + preVal) - min) / (max - min)) * h;
                    if (Math.hypot(nodeX - clickX, nodeY - clickY) < 18) {
                        return { type: 'main', i };
                    }
                }
                return null;
            };

            squigCanvas.addEventListener('mousedown', e => {
                const rect = squigCanvas.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;

                const minF = PEQDB_Module.viewMinF || 20;
                const maxF = PEQDB_Module.viewMaxF || 20000;
                const min = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 50;
                const max = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 110;
                const w = rect.width;
                const h = rect.height;

                if (PEQDB_Module.isDrawingModeActive) {
                    PEQDB_Module.isUserDrawing = true;
                    PEQDB_Module.drawnPoints = [[clickX, clickY]];
                    squigCanvas.style.cursor = 'crosshair';
                    return;
                }

                if (EQ_Module.graphFocus === 'eq' && !EQ_Module.isTuningLabActive) {
                    const eqNode = getEQNodeAtCoords(clickX, clickY, w, h, minF, maxF, min, max);
                    if (eqNode) {
                        isDraggingEQNode = true;
                        EQ_Module.isDragging = true;
                        EQ_Module.activeEQNode = eqNode;
                        squigCanvas.style.cursor = 'move';
                        return;
                    }
                }

                    if (PEQDB_Module.targetMode === 'sculptor' && EQ_Module.graphFocus === 'sculpt') {

                        for (let i = 0; i < PEQDB_Module.sculptPoints.length; i++) {
                            const p = PEQDB_Module.sculptPoints[i];
                            const nodeX = w * (Math.log10(p.hz / minF) / Math.log10(maxF / minF));
                            const nodeY = h - ((p.val - min) / (max - min)) * h;

                            if (Math.hypot(nodeX - clickX, nodeY - clickY) < 18) {
                                isDraggingSculptNode = true;
                                PEQDB_Module.isDragging = true;
                                EQ_Module.isDragging = true;
                                PEQDB_Module.activeSculptIndex = i;
                                PEQDB_Module.activeRenameUid = i;

                                squigCanvas.style.cursor = PEQDB_Module.sculptMode === 'simple' ? 'ns-resize' : 'move';
                                return;
                            }
                        }
                    }

                    if (PEQDB_Module.targetMode !== 'sculptor') {
                        isPanning = true;
                        EQ_Module.isDragging = true;
                        panStartX = e.clientX;
                        panStartY = e.clientY;
                        lastMinF = PEQDB_Module.viewMinF || 20;
                        lastMaxF = PEQDB_Module.viewMaxF || 20000;
                        squigCanvas.style.cursor = 'grabbing';
                    }
                });

                const dispatchSyntheticMouse = (type, touch) => {
                    squigCanvas.dispatchEvent(new MouseEvent(type, {
                        bubbles: true,
                        cancelable: true,
                        clientX: touch.clientX,
                        clientY: touch.clientY
                    }));
                };
                squigCanvas.addEventListener('touchstart', e => {
                    if (e.touches.length !== 1) return;
                    e.preventDefault();
                    dispatchSyntheticMouse('mousedown', e.touches[0]);
                }, { passive: false });
                window.addEventListener('touchmove', e => {
                    if (!isDraggingEQNode && !isDraggingSculptNode && !isPanning && !PEQDB_Module.isUserDrawing) return;
                    if (e.touches.length !== 1) return;
                    e.preventDefault();
                    dispatchSyntheticMouse('mousemove', e.touches[0]);
                }, { passive: false });
                window.addEventListener('touchend', e => {
                    const lastTouch = e.changedTouches && e.changedTouches[0];
                    dispatchSyntheticMouse('mouseup', lastTouch || { clientX: 0, clientY: 0 });
                });

                squigCanvas.addEventListener('dblclick', e => {
                    if (!EQ_Module.isTuningLabActive) return;
                    const rect = squigCanvas.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const clickY = e.clientY - rect.top;
                    const w = rect.width;
                    const h = rect.height;

                    const minF = PEQDB_Module.viewMinF || 20;
                    const maxF = PEQDB_Module.viewMaxF || 20000;
                    const min = PEQDB_Module.squigYMin || 50;
                    const max = PEQDB_Module.squigYMax || 110;

                    const f = Math.max(20, Math.min(20000, Math.round(Math.pow(10, Math.log10(minF) + (clickX / w) * (Math.log10(maxF) - Math.log10(minF))))));
                    const db = Math.max(min, Math.min(max, min + (1 - (clickY / h)) * (max - min)));

                    if (PEQDB_Module.sculptPoints.some(p => p.hz === f)) return;

                    PEQDB_Module.sculptPoints.push({ hz: f, val: db });
                    PEQDB_Module.sculptPoints.sort((a, b) => a.hz - b.hz);

                    PEQDB_Module.activeSculptIndex = PEQDB_Module.sculptPoints.findIndex(p => p.hz === f);
                    PEQDB_Module.updateSculptTargetData();
                    showToast("Tuning point added!", "➕");
                });

                let dragFrameId = null;
                window.addEventListener('mousemove', e => {

                    if (dragFrameId) return;

                    dragFrameId = requestAnimationFrame(() => {
                        dragFrameId = null;

                        const rect = squigCanvas.getBoundingClientRect();
                        const clientX = e.clientX - rect.left;
                        const clientY = e.clientY - rect.top;
                        const w = rect.width;
                        const h = rect.height;

                        const minF = PEQDB_Module.viewMinF || 20;
                        const maxF = PEQDB_Module.viewMaxF || 20000;
                        const min = (typeof PEQDB_Module.squigYMin === 'number') ? PEQDB_Module.squigYMin : 50;
                        const max = (typeof PEQDB_Module.squigYMax === 'number') ? PEQDB_Module.squigYMax : 110;

                        if (PEQDB_Module.isDrawingModeActive && PEQDB_Module.isUserDrawing) {
                            PEQDB_Module.drawnPoints.push([clientX, clientY]);
                            EQ_Module.drawCurve();
                            return;
                        }

                        if (isDraggingEQNode && EQ_Module.activeEQNode) {
                            const eqNode = EQ_Module.activeEQNode;
                            const alignDb = (typeof PEQDB_Module.alignDb === 'number') ? PEQDB_Module.alignDb : 75.0;
                            const preSlider = document.getElementById("eq-preampSlider");
                            const preVal = preSlider ? parseFloat(preSlider.value) : 0;

                            let f = Math.pow(10, Math.log10(minF) + (clientX / w) * (Math.log10(maxF) - Math.log10(minF)));
                            f = Math.max(20, Math.min(20000, Math.round(f)));

                            let rawDb = min + (1 - (clientY / h)) * (max - min);
                            let relativeGain = rawDb - alignDb - preVal;
                            relativeGain = Math.max(-20, Math.min(20, relativeGain));

                            let prefix = eqNode.type === 'main' ? 'eq-f' : 'eq-af';
                            let gainPrefix = eqNode.type === 'main' ? 'eq-s' : 'eq-a';

                            const hzNode = document.getElementById(prefix + eqNode.i);
                            if (hzNode) hzNode.value = Math.round(f);
                            const fsNode = document.getElementById(eqNode.type === 'main' ? `eq-fs_m${eqNode.i}` : `eq-fs_a${eqNode.i}`);
                            if (fsNode) fsNode.value = EQ_Module.logHzToSlider(f);
                            const gainNode = document.getElementById(gainPrefix + eqNode.i);
                            if (gainNode) gainNode.value = relativeGain.toFixed(1);
                            const gainNumNode = document.getElementById(eqNode.type === 'main' ? `eq-s${eqNode.i}_num` : `eq-a${eqNode.i}_num`);
                            if (gainNumNode) gainNumNode.value = relativeGain.toFixed(1);

                            EQ_Module.updateSlider(eqNode.i, eqNode.type);
                            // updateAudioConnections posts the filter payload to
                            // the worklet synchronously in this build, so the
                            // graph drag reaches DSP immediately.
                            if (EQ_Module.graphBuilt && SharedAudio.workletNode) {
                                EQ_Module.updateAudioConnections();
                            } else if (!EQ_Module.graphBuilt) {
                                // Queue for when the worklet finishes booting
                                EQ_Module._pendingDspQueue = EQ_Module._pendingDspQueue || [];
                                if (!EQ_Module._pendingDspQueue.includes('filters')) EQ_Module._pendingDspQueue.push('filters');
                                EQ_Module.ensureDSPGraph().catch(()=>{});
                            }
                            EQ_Module.drawCurve();
                            if (window.syncGlobalSliders) {
                                if (hzNode) window.syncGlobalSliders(hzNode);
                                if (gainNode) window.syncGlobalSliders(gainNode);
                                if (fsNode) window.syncGlobalSliders(fsNode);
                            }
                            return;
                        }

                        if (isDraggingSculptNode && PEQDB_Module.activeSculptIndex > -1) {
                            const points = PEQDB_Module.sculptPoints;
                            const idx = PEQDB_Module.activeSculptIndex;
                            const p = points[idx];

                            let db = min + (1 - (clientY / h)) * (max - min);
                            p.val = Math.max(min, Math.min(max, db));

                            let f = Math.pow(10, Math.log10(minF) + (clientX / w) * (Math.log10(maxF) - Math.log10(minF)));

                            const minBound = idx > 0 ? points[idx - 1].hz + 5 : 20;
                            const maxBound = idx < points.length - 1 ? points[idx + 1].hz - 5 : 20000;

                            p.hz = Math.max(minBound, Math.min(maxBound, Math.round(f)));

                            const hzInput = document.getElementById('sculptor-node-hz');
                            const dbInput = document.getElementById('sculptor-node-db');
                            if (hzInput) hzInput.value = p.hz;
                            if (dbInput) dbInput.value = p.val.toFixed(1);

                            PEQDB_Module.updateSculptTargetData();

                            if (PEQDB_Module.searchMode === 'similar') {
                                PEQDB_Module.findSimilarCurves();
                            }

                            self.drawCurve();
                            return;
                        }

                        if (!isPanning && !isDraggingEQNode && !isDraggingSculptNode) {
                            let eqHoverNode = null;
                            if (EQ_Module.graphFocus === 'eq') {
                                eqHoverNode = getEQNodeAtCoords(clientX, clientY, w, h, minF, maxF, min, max);
                            }

                            const hoverChanged = (EQ_Module.hoverEQNode?.i !== eqHoverNode?.i) || (EQ_Module.hoverEQNode?.type !== eqHoverNode?.type);
                            if (hoverChanged) {
                                EQ_Module.hoverEQNode = eqHoverNode;
                                EQ_Module.drawCurve();
                            }

                            let sculptHoverIdx = -1;
                            if (PEQDB_Module.targetMode === 'sculptor' && EQ_Module.graphFocus === 'sculpt') {
                                for (let i = 0; i < PEQDB_Module.sculptPoints.length; i++) {
                                    const p = PEQDB_Module.sculptPoints[i];
                                    const nodeX = w * (Math.log10(p.hz / minF) / Math.log10(maxF / minF));
                                    const nodeY = h - ((p.val - min) / (max - min)) * h;
                                    if (Math.hypot(nodeX - clientX, nodeY - clientY) < 18) {
                                        sculptHoverIdx = i;
                                        break;
                                    }
                                }
                            }

                            if (PEQDB_Module.hoverSculptIndex !== sculptHoverIdx) {
                                PEQDB_Module.hoverSculptIndex = sculptHoverIdx;
                                EQ_Module.drawCurve();
                            }

                            if (eqHoverNode) {
                                squigCanvas.style.cursor = 'pointer';
                            } else if (sculptHoverIdx !== -1) {
                                squigCanvas.style.cursor = PEQDB_Module.sculptMode === 'simple' ? 'ns-resize' : 'pointer';
                            } else {
                                squigCanvas.style.cursor = 'default';
                            }
                        }

                        if (!isPanning) return;
                        const deltaX = e.clientX - panStartX;
                        const deltaY = e.clientY - panStartY;

                        if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return;

                        const logRange = Math.log10(lastMaxF / lastMinF);
                        const shiftX = -(deltaX / rect.width) * logRange;
                        let newMinF = Math.pow(10, Math.log10(lastMinF) + shiftX);
                        let newMaxF = Math.pow(10, Math.log10(lastMaxF) + shiftX);

                        if (newMinF < 20) {
                            newMinF = 20;
                            newMaxF = 20 * Math.pow(10, logRange);
                        }
                        if (newMaxF > 20000) {
                            newMaxF = 20000;
                            newMinF = 20000 / Math.pow(10, logRange);
                        }

                        PEQDB_Module.viewMinF = newMinF;
                        PEQDB_Module.viewMaxF = newMaxF;
                        // Deliberately frequency-axis (X) only. Dragging the
                        // graph background must never move the Y-axis / shift
                        // every band's on-screen level together -- that's
                        // exactly what it looks like when the whole curve and
                        // all 10 nodes appear to move up/down at once, and it
                        // should only ever happen via the Amp (preamp) and
                        // Align (dB reference) controls, which adjust the
                        // actual EQ state rather than just panning the view.
                        // A prior pass here computed and clamped a vertical
                        // newMinY/newMaxY pan and committed it to
                        // PEQDB_Module.squigYMin/squigYMax -- since those two
                        // values are exactly what getEQNodeAtCoords() (above)
                        // adds into every node's Y position, that vertical
                        // commit was the bug: it silently shifted every
                        // node's *displayed* level in lockstep on any
                        // background drag, with no actual gain change behind
                        // it. Removed; only horizontal panning is wired up.

                        self.drawCurve();
                    });
                });

                window.addEventListener('mouseup', () => {
                    if (PEQDB_Module.isDrawingModeActive && PEQDB_Module.isUserDrawing) {
                        PEQDB_Module.isUserDrawing = false;
                        squigCanvas.style.cursor = 'default';

                        const w = squigCanvas.clientWidth;
                        const h = squigCanvas.clientHeight;

                        const minF = PEQDB_Module.viewMinF || 20;
                        const maxF = PEQDB_Module.viewMaxF || 20000;
                        const min = PEQDB_Module.squigYMin || 50;
                        const max = PEQDB_Module.squigYMax || 110;

                        const rawCoords = PEQDB_Module.drawnPoints.map(([x, y]) => {
                            const f = Math.pow(10, Math.log10(minF) + (x / w) * (Math.log10(maxF) - Math.log10(minF)));
                            const db = min + (1 - (y / h)) * (max - min);
                            return [f, db];
                        }).sort((a, b) => a[0] - b[0]);

                        const uniqueCoords = [];
                        for (let i = 0; i < rawCoords.length; i++) {
                            if (i === 0 || Math.abs(rawCoords[i][0] - rawCoords[i-1][0]) > 0.5) {
                                uniqueCoords.push(rawCoords[i]);
                            }
                        }

                        if (uniqueCoords.length >= 2) {
                            const tempSpline = PEQDB_Module.Spline.build(uniqueCoords);
                            if (tempSpline) {
                                PEQDB_Module.sculptPoints = PEQDB_Module.sculptPoints.map(p => {
                                    const newVal = PEQDB_Module.Spline.evaluate(tempSpline, p.hz);
                                    return { hz: p.hz, val: Math.max(min, Math.min(max, newVal)) };
                                });
                                if (window.EQ_Sculptor) {
                                    EQ_Sculptor.sculptPoints = PEQDB_Module.sculptPoints.map(p=> ({hz:p.hz,val:p.val}));
                                }
                                PEQDB_Module.updateSculptTargetData();
                                if (PEQDB_Module.searchMode === 'similar') {
                                    PEQDB_Module.findSimilarCurves();
                                }
                            }
                        }
                        PEQDB_Module.drawnPoints = [];
                        EQ_Module.drawCurve();
                    }
                    if (isDraggingEQNode) {
                        isDraggingEQNode = false;
                        EQ_Module.isDragging = false;
                        EQ_Module.activeEQNode = null;
                        squigCanvas.style.cursor = 'default';
                    }
                    if (isDraggingSculptNode) {
                        isDraggingSculptNode = false;
                        PEQDB_Module.isDragging = false;
                        EQ_Module.isDragging = false;
                        squigCanvas.style.cursor = 'default';
                        // Every mid-drag findSimilarCurves call bailed out via the
                        // isDragging guard, and nothing re-ran the scan after
                        // release — Similar-mode kept showing pre-drag matches.
                        // The debounced rescan coalesces rapid re-drags.
                        if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                            PEQDB_Module.debouncedFindSimilarCurves();
                        }
                    }
                    if (isPanning) {
                        isPanning = false;
                        EQ_Module.isDragging = false;
                        squigCanvas.style.cursor = 'default';
                    }
                });

                squigCanvas.addEventListener('wheel', e => {

                    if (PEQDB_Module.targetMode === 'sculptor') return;

                    e.preventDefault();
                    const rect = squigCanvas.getBoundingClientRect();
                    const mouseX = e.clientX - rect.left;

                    const minF = PEQDB_Module.viewMinF || 20;
                    const maxF = PEQDB_Module.viewMaxF || 20000;
                    const mouseF = minF * Math.pow(10, (mouseX / rect.width) * Math.log10(maxF / minF));

                    const zoomFactor = e.deltaY > 0 ? 1.15 : 0.85;

                    let newMinF = mouseF / Math.pow(mouseF / minF, zoomFactor);
                    let newMaxF = mouseF * Math.pow(maxF / mouseF, zoomFactor);

                    if (newMinF < 20) newMinF = 20;
                    if (newMaxF > 20000) newMaxF = 20000;

                    PEQDB_Module.viewMinF = newMinF;
                    PEQDB_Module.viewMaxF = newMaxF;
                    self.drawCurve();
                }, { passive: false });

                squigCanvas.addEventListener('dblclick', () => {

                    if (PEQDB_Module.targetMode === 'sculptor') return;

                    PEQDB_Module.viewMinF = 20;
                    PEQDB_Module.viewMaxF = 20000;

                    PEQDB_Module.updateAlignmentCfgActual();
                });

                squigCanvas.addEventListener('mousemove', e => {
                    const rect = squigCanvas.getBoundingClientRect();

                    EQ_Module.squigMouseX = (e.clientX - rect.left);
                    EQ_Module.squigMouseY = (e.clientY - rect.top);
                    if (!isPanning && !isDraggingSculptNode) {
                        self.drawCurve();
                    }
                });
                squigCanvas.addEventListener('mouseleave', () => {
                    EQ_Module.squigMouseX = null;
                    EQ_Module.squigMouseY = null;
                    self.drawCurve();
                });
            }
        },

        switchFaderTab: function(tabId) {
            this.activeFaderTab = tabId;
            const pStd = document.getElementById('eq-panel-standard');
            const pAdv = document.getElementById('eq-panel-advanced');
            const tStd = document.getElementById('eq-tab-standard');
            const tAdv = document.getElementById('eq-tab-advanced');

            if (pStd && pAdv) {
                if (tabId === 'standard') {
                    pStd.classList.remove('hidden');
                    pAdv.classList.add('hidden');
                    if (tStd) tStd.classList.add('active');
                    if (tAdv) tAdv.classList.remove('active');
                } else {
                    pStd.classList.add('hidden');
                    pAdv.classList.remove('hidden');
                    if (tStd) tStd.classList.remove('active');
                    if (tAdv) tAdv.classList.add('active');
                }
            }

            const stepperLabel = document.getElementById('eq-fader-stepper-label');
            if (stepperLabel) {
                const info = this.faderModes.find(m => m.id === tabId) || this.faderModes[0];
                stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
            }
        },

                enterTuningLab: function() {
            Mascot.triggerTemporaryExpression('genius', 2500);
            const activeTarget = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target');
            setTimeout(() => Mascot.update(), 10);
            if (!activeTarget) {
                showToast("Please select a target curve from the dropdown menu first!", "⚠️");
                return;
            }

            this.isTuningLabActive = true;
            this.isDragging = false;
            this.isDraggingNode = false;
            this.manualMainGains = null;
            this.manualAdvGains = null;

            PEQDB_Module.savedTargetCurveBackup = {
                id: activeTarget.id,
                uid: activeTarget.uid,
                name: activeTarget.name,
                data: Array.isArray(activeTarget.data) ? activeTarget.data.map(function(pt) { return [pt[0], pt[1]]; }) : activeTarget.data,
                color: activeTarget.color
            };

            const normData = PEQDB_Module.getNormalizedData(activeTarget.data, activeTarget.name);
            const spline = PEQDB_Module.Spline.build(normData);
            if (spline) {
                const defaultHzs = [22, 100, 350, 1000, 3000, 5500, 10000, 18000];
                PEQDB_Module.sculptPoints = defaultHzs.map(hz => {
                    const val = PEQDB_Module.Spline.evaluate(spline, hz);
                    return { hz: hz, val: val };
                });
            }

            PEQDB_Module.targetMode = 'sculptor';
            this.graphFocus = 'sculpt';

            const overlay = document.getElementById('graph-focus-selector');
            if (overlay) overlay.classList.remove('hidden');

            const editBtn = document.getElementById('target-edit-btn');
            if (editBtn) {
                editBtn.classList.add('active-btn', 'active-yellow');
                editBtn.innerHTML = '🔒';
                editBtn.title = "Lock and Apply Target Changes";
            }

            PEQDB_Module.updateSculptTargetData();
            showToast("Entering Target Sculptor Lab Mode...", "✏️");
            this.drawCurve();
        },

                exitTuningLab: function(applyChanges) {
            Mascot.isGeniusActive = false;
            this.isTuningLabActive = false;
            this.graphFocus = 'eq';
            setTimeout(() => Mascot.update(), 10);

            if (PEQDB_Module.isDrawingModeActive) {
                PEQDB_Module.toggleDrawMode();
            }

            const overlay = document.getElementById('graph-focus-selector');
            if (overlay) overlay.classList.add('hidden');

            const editBtn = document.getElementById('target-edit-btn');
            if (editBtn) {
                editBtn.classList.remove('active-btn', 'active-yellow');
                editBtn.innerHTML = '✏️';
                editBtn.title = "Open Target Sculptor Lab";
            }

            const hzSelector = document.getElementById('align-hz-selector');
            const dbSelector = document.getElementById('align-db-selector');
            if (hzSelector) hzSelector.style.pointerEvents = 'auto';
            if (dbSelector) dbSelector.style.pointerEvents = 'auto';
            if (hzSelector) hzSelector.style.opacity = '1';
            if (dbSelector) dbSelector.style.opacity = '1';

            if (applyChanges) {
                const activeTarget = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target');
                if (activeTarget) {
                    activeTarget.name = "Custom Target";
                }
                PEQDB_Module.renderActiveCurvesDock();
                                Mascot.triggerTemporaryExpression('cool', 1500);
                showToast("Custom Target applied successfully!", "💾");
            } else {
                const backup = PEQDB_Module.savedTargetCurveBackup;
                if (backup) {
                    const activeTarget = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'target');
                    if (activeTarget) {
                        activeTarget.name = backup.name;
                        activeTarget.data = backup.data;
                        activeTarget.cachedNormalized = null;
                        activeTarget.cachedSpline = null;
                    }
                }
                showToast("Tuning Lab closed. Changes discarded.", "🚫");
            }

            this.drawCurve();
        },

        buildStandardEQ: function() {
            const container = document.getElementById("eq-panel-standard");
            if (!container) return;
            container.innerHTML = "";

            const bandColors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];

            this.bands.forEach((b, i) => {
                const color = bandColors[i % bandColors.length];
                const card = document.createElement("div");
                card.id = `standard_card_m${i}`;
                card.className = "eq-band-card flex flex-col gap-1 p-2";
                card.style.setProperty('--band-color', color);

                card.innerHTML = `
                    <div class="flex items-center justify-between text-[10px] select-none font-bold" draggable="false">
                        <div class="flex items-center gap-1.5" draggable="false">
                            <span class="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-black text-white" style="background-color: var(--band-color);">${i + 1}</span>
                            <span class="text-zinc-350 text-[10px]">${b.emoji} ${b.name}</span>
                        </div>
                        <div class="flex items-center gap-1.5 font-mono text-zinc-400" draggable="false">
                            <span class="text-[9px] text-zinc-555">${b.hz}Hz</span>
                            <span id="eq-s${i}-std-val" class="font-extrabold min-w-[54px] text-right text-[10px] whitespace-nowrap" style="color: var(--band-color);">0.0 dB</span>
                        </div>
                    </div>
                    <div class="flex items-center h-4 mt-1" draggable="false">
                        <input type="range" id="eq-s${i}-std" min="-20" max="20" step="0.1" value="0" class="w-full" oninput="EQ.handleStandardSlider(${i}, this.value)" draggable="false">
                    </div>
                `;
                container.appendChild(card);
            });
        },

        handleStandardSlider: function(i, val) {
            const value = parseFloat(val);

            const advSlider = document.getElementById("eq-s" + i);
            const advNum = document.getElementById(`eq-s${i}_num`);
            if (advSlider) advSlider.value = value;
            if (advNum) advNum.value = value.toFixed(1);

            this.updateSlider(i, 'main');
        },

        buildEQ: function() {
            const mainContainer = document.getElementById("eq-main");
            if (!mainContainer) return;

            mainContainer.innerHTML = "";

            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const bandColors = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#f43f5e'];

            this.buildStandardEQ();

            this.bands.forEach((b, i) => {
                const color = bandColors[i % bandColors.length];
                const isBypassed = window.bypassedBands.has("m" + i);
                const bandDiv = document.createElement("div");
                bandDiv.id = `card_m${i}`;
                bandDiv.className = `eq-band-card flex flex-col gap-1.5 ${isBypassed ? 'bypassed' : ''}`;
                bandDiv.style.setProperty('--band-color', color);

                const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                const currentLabel = labelMap[b.type || 'peaking'] || 'PK';
                const currentSlope = b.slope || 12;

                const isSlopeVisible = ['lowshelf', 'highshelf', 'lowpass', 'highpass'].includes(b.type || 'peaking');

                bandDiv.innerHTML = `
                    <div class="flex items-center justify-between w-full h-5 select-none" draggable="false">
                        <div class="flex items-center gap-1" draggable="false">
                            <span class="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white flex-shrink-0" style="background-color: var(--band-color);">${i + 1}</span>
                            <button onclick="EQ.cycleBandType(${i})" id="eq-t_m${i}" class="eq-card-select px-2" style="color: var(--band-color);" draggable="false">${currentLabel}</button>
                            <button onclick="EQ.cycleBandSlope(${i})" id="eq-sl_m${i}" class="eq-card-select px-1.5 ml-1 ${isSlopeVisible ? '' : 'hidden'}" style="color: var(--text-secondary); border-color: rgba(255,255,255,0.04);" title="Filter steepness (12—48 dB/octave)" draggable="false">${currentSlope}dB</button>
                        </div>

                        <div class="flex items-center gap-1" draggable="false">
                            <button onclick="EQ.copyBand(${i})" class="eq-card-action-btn" draggable="false">Copy</button>
                            <button onclick="EQ.resetBand(${i})" class="eq-card-action-btn" draggable="false">Reset</button>
                            <button onclick="EQ.toggleBandBypass(${i})" id="eq-bp_m${i}" class="text-[8px] font-black cursor-pointer focus:outline-none ml-1" style="color: ${isBypassed ? 'var(--accent-red)' : 'var(--accent-green)'}" draggable="false">
                                ${isBypassed ? '🔴' : '🟢'}
                            </button>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 gap-1.5 pt-1 border-t border-white/[0.03]" draggable="false">
                        <div class="flex items-center justify-between gap-2 h-5" id="row-tune_m${i}" draggable="false">
                            <span class="eq-card-label w-7">Tune</span>
                            <input type="number" id="eq-f${i}" value="${b.hz}" min="20" max="20000" class="eq-card-input w-16" onchange="EQ.handleFreqNumInput(${i}, this.value)" draggable="false">
                            <input type="range" id="eq-fs_m${i}" min="0" max="1000" value="${this.logHzToSlider(b.hz)}" class="flex-grow flex-1" oninput="EQ.handleFreqSlider(${i}, this.value)" draggable="false">
                        </div>

                        <div class="flex items-center justify-between gap-2 h-5" id="row-gain_m${i}" draggable="false">
                            <span class="eq-card-label w-7">Gain</span>
                            <input type="number" id="eq-s${i}_num" value="0.0" step="0.1" class="eq-card-input w-16" onchange="EQ.handleGainNumInput(${i}, this.value)" draggable="false">
                            <input type="range" id="eq-s${i}" min="-20" max="20" step="0.1" value="0" class="flex-grow flex-1" oninput="EQ.updateSlider(${i})" draggable="false">
                        </div>

                        <div class="flex items-center justify-between gap-2 h-5" id="row-q_m${i}" draggable="false">
                            <span class="eq-card-label w-7">Q</span>
                            <input type="number" id="eq-q_m${i}_num" value="${b.defaultQ}" step="0.05" class="eq-card-input w-16" onchange="EQ.handleQNumInput(${i}, this.value)" draggable="false">
                            <input type="range" id="eq-q_m${i}" min="0.1" max="10" step="0.1" value="${b.defaultQ}" class="flex-grow flex-1" oninput="EQ.updateSlider(${i})" draggable="false">
                        </div>
                    </div>
                `;
                mainContainer.appendChild(bandDiv);
            });

            setTimeout(() => {
                this.bands.forEach((_, i) => this.updateSlider(i));
            }, 50);
        },

        updateSlider: function(i, type = 'main') {

            // Dot dragging on the frequency graph writes slider values directly via
            // `.value =` (no `input` event), so the magnitude cache's document-input
            // invalidation never fires. Bump the cache version here so the curve
            // recomputes and follows the dragged node immediately.
            if (this._magFiltersVersion == null) this._magFiltersVersion = 0;
            this._magFiltersVersion++;
            this._magLiveTrackSetup = true;

            // Any hands-on band change (sliders, number boxes, type/slope cycles,
            // bypass toggles, graph-node drags) reshapes the DSP curve — unlock
            // live Similar-mode matching. Without this the gate flag was only
            // ever set by preamp/master-tone moves, so dragging bands left the
            // Similar tab stuck at "0 matches" until something else moved the
            // preamp (e.g. running AutoEQ).
            if (!EQ_Module.isProgrammaticSliderUpdate && typeof PEQDB_Module !== 'undefined') {
                PEQDB_Module._similarTargetEverModified = true;
            }

            if (window.bypassedBands === undefined) window.bypassedBands = new Set();

            if (!this.eqEnabled && !EQ_Module.isProgrammaticSliderUpdate) {
                this.eqEnabled = true;
                const eqBtn = document.getElementById("eqToggleBtn");
                if (eqBtn) {
                    eqBtn.classList.add('is-on');
                    eqBtn.textContent = "EQ: ON";
                }
                this.updateAudioConnections();
            }

            const setSliderFill = (slider, val, min, max) => {
                if (!slider) return;
                const percent = ((val - min) / (max - min)) * 100;
                slider.style.setProperty('--track-percent', `${percent}%`);
            };

            if (type === 'main') {
                const slider = document.getElementById("eq-s" + i);
                const qSlider = document.getElementById("eq-q_m" + i);
                const fInput = document.getElementById("eq-f" + i);
                const fsSlider = document.getElementById(`eq-fs_m${i}`);
                const typeBtn = document.getElementById(`eq-t_m${i}`);

                if (!slider || !qSlider || !fInput) return;

                const selectedType = typeBtn ? (this.bands[i].type || 'peaking') : 'peaking';
                const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(selectedType);

                let gain = hasNoGain ? 0.0 : parseFloat(slider.value);
                // Dead-zone snapping is a live-drag nicety only. It must not run
                // for programmatic loads (AutoEQ results, presets, imported
                // profiles) or it would silently zero solved bands <= 0.4 dB
                // after the solver had already committed them.
                if (!hasNoGain && !EQ_Module.isProgrammaticSliderUpdate && Math.abs(gain) <= 0.4) {
                    gain = 0.0;
                    slider.value = "0.0";
                }

                let q = parseFloat(qSlider.value);
                if (!EQ_Module.isProgrammaticSliderUpdate && Math.abs(q - 1.0) <= 0.08) {
                    q = 1.0;
                    qSlider.value = "1.0";
                }

                // The number boxes are mirrors of the range sliders, which clamp
                // to their min/max on assignment — so out-of-range typed values
                // can never reach the DSP anyway. Always resync the box to the
                // effective (clamped) value instead of letting the label claim a
                // gain/Q that isn't actually applied.
                const typedGainBox = document.getElementById(`eq-s${i}_num`);
                if (!hasNoGain && typedGainBox && typedGainBox !== document.activeElement) {
                    typedGainBox.value = gain.toFixed(1);
                }

                const typedQBox = document.getElementById(`eq-q_m${i}_num`);
                if (typedQBox && typedQBox !== document.activeElement) {
                    typedQBox.value = q.toFixed(2);
                }

                const hz = parseFloat(fInput.value) || this.bands[i].hz;

                if (!hasNoGain) {
                    setSliderFill(slider, Math.max(-20, Math.min(20, gain)), -20, 20);
                }
                setSliderFill(qSlider, Math.max(0.1, Math.min(10, q)), 0.1, 10);
                if (fsSlider) {
                    setSliderFill(fsSlider, parseFloat(fsSlider.value), 0, 1000);
                }

                this.recalculateAutoGainMatch();
                this.updatePreamp();

                if (this.graphBuilt && !EQ_Module.isProgrammaticSliderUpdate) {
                    this.updateAudioConnections();
                }

                const stdSlider = document.getElementById(`eq-s${i}-std`);
                const stdValDisp = document.getElementById(`eq-s${i}-std-val`);
                if (stdSlider) {
                    stdSlider.value = gain;
                    setSliderFill(stdSlider, gain, -20, 20);
                }
                if (stdValDisp) {
                    stdValDisp.textContent = (gain >= 0 ? "+" : "") + gain.toFixed(1) + " dB";
                }
                const standardCard = document.getElementById(`standard_card_m${i}`);
                if (standardCard) {
                    const isBypassed = window.bypassedBands.has("m" + i);
                    if (isBypassed) {
                        standardCard.classList.add('bypassed');
                    } else {
                        standardCard.classList.remove('bypassed');
                    }
                }
            } else {
                const b = this.advancedBands[i];
                const slider = document.getElementById("eq-a" + i);
                const qSlider = document.getElementById("eq-q_a" + i);

                if (slider) setSliderFill(slider, b.g !== undefined ? b.g : 0, -20, 20);
                if (qSlider) setSliderFill(qSlider, b.q !== undefined ? b.q : b.defaultQ, 0.1, 10);

                this.recalculateAutoGainMatch();
                this.updatePreamp();

                if (this.graphBuilt && !EQ_Module.isProgrammaticSliderUpdate) {
                    this.updateAudioConnections();
                }
            }

            if (!this._suppressDraw) this.drawCurve();
            if (!EQ_Module.isProgrammaticSliderUpdate && PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                PEQDB_Module.debouncedFindSimilarCurves();
            }
        },

        handlePreampNumInput: function(textVal) {
            const val = parseFloat(textVal) || 0.0;
            const clampedVal = Math.max(-40, Math.min(40, val));

            const numInput = document.getElementById("eq-preampVal");
            if (numInput) numInput.value = clampedVal.toFixed(1);

            const slider = document.getElementById("eq-preampSlider");
            if (slider) {
                slider.value = Math.max(-20, Math.min(20, clampedVal));
            }
            this.updatePreamp();
        },

        updatePreamp: function() {
            // Live interaction window: grants the graph redraw the 16ms fast
            // path while this slider is being moved (see eq-draw-curve.js).
            this._liveDragUntil = performance.now() + 150;
            const preampSlider = document.getElementById("eq-preampSlider");
            let prevPreampVal = null;
            let val = null;
            if (preampSlider) {
                val = parseFloat(preampSlider.value) || 0;
                prevPreampVal = (this._lastPreampVal === undefined) ? null : this._lastPreampVal;
                this._lastPreampVal = val;

                if (!window.isProgrammaticPreampUpdate && Math.abs(val) <= 0.3) {
                    val = 0.0;
                    preampSlider.value = "0.0";
                }

                if (!window.isProgrammaticPreampUpdate && prevPreampVal !== null && prevPreampVal !== val) {
                    PEQDB_Module._similarTargetEverModified = true;
                    if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                        PEQDB_Module.debouncedFindSimilarCurves();
                    }
                }

                const preValEl = document.getElementById("eq-preampVal");
                const preDispEl = document.getElementById("eq-preampDisplay");
                if (preValEl && preValEl !== document.activeElement) {
                    preValEl.value = val.toFixed(1);
                }
                if (preDispEl) {
                    preDispEl.textContent = (val >= 0 ? "+" : "") + val.toFixed(1) + " dB";
                }

                // Paint via the shared track painter so the unfilled remainder
                // matches every other slider (#ffffff) — the old custom gradient
                // used rgba(255,255,255,0.08), which read as a darker bar.
                if (window.paintSliderTrack) {
                    window.paintSliderTrack(preampSlider);
                } else {
                    const min = parseFloat(preampSlider.min || -20);
                    const max = parseFloat(preampSlider.max || 20);
                    const percent = ((val - min) / (max - min)) * 100;
                    preampSlider.style.background = `linear-gradient(90deg, var(--accent-blue) ${percent}%, #ffffff ${percent}%)`;
                }

                if (!window.isProgrammaticPreampUpdate) {
                    window.userPreampTarget = val;
                }

                let finalPreamp = val;
                if (preValEl && preValEl === document.activeElement) {
                    const typedVal = parseFloat(preValEl.value);
                    if (!isNaN(typedVal)) {
                        finalPreamp = typedVal;
                    }
                }
                // Use shared computation (single source of truth)
                finalPreamp = this.computeEffectivePreamp();

                if (this.graphBuilt && SharedAudio.workletNode) {
                    SharedAudio.workletNode.port.postMessage({
                        type: 'updatePreamp',
                        preampDb: finalPreamp
                    });
                }
            }
            if (!this._suppressDraw) this.drawCurve();
            if (!EQ_Module.isProgrammaticSliderUpdate && PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                PEQDB_Module.debouncedFindSimilarCurves();
            }
        },
        computeEffectivePreamp: function() {
            const preampSlider = document.getElementById("eq-preampSlider");
            let val = preampSlider ? (parseFloat(preampSlider.value) || 0) : 0;
            
            if (this.autoGainMatchActive && this.eqEnabled) {
                val += this.autoGainCompensationDb || 0;
            }
            if (this.hearingCalEnabled && this._hearingMaxBoost) {
                val -= this._hearingMaxBoost;
            }
            if (this.loudnessActive && this._loudnessMaxBoost) {
                val -= this._loudnessMaxBoost;
            }
            if (this._masterToneMaxBoost) {
                val -= this._masterToneMaxBoost;
            }
            return val;
        },
        enablePreampEdit: function() {
            const disp = document.getElementById("eq-preampDisplay");
            const input = document.getElementById("eq-preampVal");
            if (disp && input) {
                disp.classList.add("hidden");
                input.classList.remove("hidden");
                input.focus();
                input.select();
            }
        },
        commitPreampEdit: function() {
            const disp = document.getElementById("eq-preampDisplay");
            const input = document.getElementById("eq-preampVal");
            if (disp && input) {
                const typedVal = parseFloat(input.value) || 0.0;
                this.handlePreampNumInput(typedVal);
                input.classList.add("hidden");
                disp.classList.remove("hidden");
            }
        },

        updateBalance: function(val) {
            const value = parseFloat(val);
            const valEl = document.getElementById('a11y-balance-label');
            setTimeout(() => Mascot.update(), 10);
            if (valEl) {
                if (value === 0) valEl.textContent = 'Center';
                else if (value < 0) valEl.textContent = 'L ' + Math.abs(Math.round(value * 100)) + '%';
                else valEl.textContent = 'R ' + Math.round(value * 100) + '%';
            }
            if (SharedAudio.masterPanner) {
                setAudioParamSmooth(SharedAudio.masterPanner.pan, value);
            }
        },

        updateMasterTone: function(type, val) {
            this._liveDragUntil = performance.now() + 150;
            if (!EQ_Module.isProgrammaticSliderUpdate) PEQDB_Module._similarTargetEverModified = true;
            const value = parseFloat(val);
            const disp = document.getElementById(`eq-master${type.charAt(0).toUpperCase() + type.slice(1)}Val`);
            if (disp) {
                disp.textContent = (value >= 0 ? "+" : "") + value.toFixed(1) + " dB";
            }

            const bassSlider = document.getElementById("eq-masterBass");
            const trebSlider = document.getElementById("eq-masterTreble");

            const bassGain = bassSlider ? parseFloat(bassSlider.value) : 0.0;
            const trebGain = trebSlider ? parseFloat(trebSlider.value) : 0.0;

            // Only positive (boost) values create headroom risk; a cut
            // needs no compensation. max(), not sum(), matches the same
            // reasoning as _loudnessMaxBoost -- these two shelves act on
            // largely disjoint low/high bands, so bounding on the worst of
            // the two avoids over-attenuating when only one is active.
            this._masterToneMaxBoost = Math.max(0, bassGain, trebGain);
            this.updatePreamp();

            if (!this.graphBuilt || !SharedAudio.workletNode) return;

            SharedAudio.workletNode.port.postMessage({
                type: 'updateSimulations',
                sims: [
                    { index: 22, bypassed: bassGain === 0, filterType: 'lowshelf', frequency: 105, gain: bassGain, q: 0.7 },
                    { index: 23, bypassed: trebGain === 0, filterType: 'highshelf', frequency: 8000, gain: trebGain, q: 0.7 }
                ]
            });
            // updatePreamp() above already calls drawCurve() -- no need to
            // redraw a second time here.
        },

        // Genre Target picker (the 🎯 button next to the Music/Gaming Match
        // badges). The HTML panel/list/apply/close markup and CSS already
        // existed in full -- these four onclick handlers were the only
        // piece missing, so every click here previously threw with no UI
        // feedback. Reuses FindEngine.genreFamilies (the same 16-family
        // classifier that drives the *automatic* match badges) so picking
        // "Rock" here targets the exact same tonal profile the badge would
        // show if a curve naturally matched Rock.
        _genreTargetState: { music: { open: false, listOpen: false, selectedIdx: -1 }, game: { open: false, listOpen: false, selectedIdx: -1 } },

        toggleGenreTargetPicker: function(side) {
            const st = this._genreTargetState[side];
            st.open = !st.open;
            const panel = document.getElementById(`${side}-genre-target-panel`);
            if (panel) panel.classList.toggle('hidden', !st.open);
            if (st.open) {
                this._renderGenreTargetLabel(side);
            } else {
                st.listOpen = false;
                const list = document.getElementById(`${side}-genre-target-list`);
                if (list) list.classList.add('hidden');
            }
        },

        closeGenreTargetPicker: function(side) {
            const st = this._genreTargetState[side];
            st.open = false;
            st.listOpen = false;
            const panel = document.getElementById(`${side}-genre-target-panel`);
            if (panel) panel.classList.add('hidden');
            const list = document.getElementById(`${side}-genre-target-list`);
            if (list) list.classList.add('hidden');
        },

        toggleGenreTargetList: function(side) {
            const st = this._genreTargetState[side];
            const list = document.getElementById(`${side}-genre-target-list`);
            if (!list) return;
            st.listOpen = !st.listOpen;
            list.classList.toggle('hidden', !st.listOpen);
            if (st.listOpen) this._renderGenreTargetList(side);
        },

        _renderGenreTargetList: function(side) {
            const list = document.getElementById(`${side}-genre-target-list`);
            if (!list) return;
            const st = this._genreTargetState[side];
            const families = (typeof FindEngine !== 'undefined' && FindEngine.genreFamilies) ? FindEngine.genreFamilies : [];
            list.innerHTML = '';
            families.forEach((fam, i) => {
                const variant = side === 'music' ? (fam.musicVariants && fam.musicVariants[0]) : (fam.gameVariants && fam.gameVariants[0]);
                if (!variant) return;
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'genre-target-item' + (st.selectedIdx === i ? ' genre-target-item-active' : '');
                const numSpan = document.createElement('span');
                numSpan.className = 'genre-target-item-num';
                numSpan.textContent = String(i + 1);
                item.appendChild(numSpan);
                item.appendChild(document.createTextNode(`${variant.emoji} ${variant.name}`));
                item.onclick = () => {
                    st.selectedIdx = i;
                    st.listOpen = false;
                    list.classList.add('hidden');
                    this._renderGenreTargetLabel(side);
                };
                list.appendChild(item);
            });
            const count = families.length;
            const countLabel = document.getElementById(`${side}-genre-target-count`);
            if (countLabel) countLabel.textContent = count + ' genres';
        },

        _renderGenreTargetLabel: function(side) {
            const st = this._genreTargetState[side];
            const label = document.getElementById(`${side}-genre-target-label`);
            const hint = document.getElementById(`${side}-genre-target-hint`);
            const families = (typeof FindEngine !== 'undefined' && FindEngine.genreFamilies) ? FindEngine.genreFamilies : [];
            const fam = families[st.selectedIdx];
            const variant = fam ? (side === 'music' ? fam.musicVariants[0] : fam.gameVariants[0]) : null;
            if (label) label.textContent = variant ? `${variant.emoji} ${variant.name}` : 'Choose a genre…';
            if (hint) hint.textContent = variant
                ? `Apply AutoEQ to push the active curve toward ${variant.name}'s tonal signature.`
                : 'Pick a genre, then Apply AutoEQ.';
        },

        applyGenreTargetAutoEQ: function(side) {
            const st = this._genreTargetState[side];
            const families = (typeof FindEngine !== 'undefined' && FindEngine.genreFamilies) ? FindEngine.genreFamilies : [];
            const fam = families[st.selectedIdx];
            if (!fam) { showToast("Pick a genre first.", "⚠️"); return; }

            const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
            if (!baseCurve) { showToast("Load a curve into Base first.", "⚠️"); return; }

            const variant = side === 'music' ? fam.musicVariants[0] : fam.gameVariants[0];
            // fam.profile is the same [sub, warmth, vocal, treble, air] delta
            // shape getEqBandDeltas() derives from a real 10-band FR (see
            // FindEngine.getEqBandDeltas / nearestGenreFamilyIndex) --
            // expanding it back out to those same band frequencies, plus
            // 20Hz/20kHz endpoints so the curve interpolates cleanly across
            // the full audible range instead of collapsing to 0 past the
            // outermost defined point.
            const [sub, warmth, vocal, treble, air] = fam.profile;
            const data = [
                [20, sub], [31, sub], [62, sub],
                [125, warmth], [250, warmth],
                [1000, vocal],
                [2000, treble], [4000, treble],
                [8000, air], [16000, air], [20000, air]
            ];

            PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'target');
            PEQDB_Module.STATE.activeCurves.push({
                uid: 'target-genre-' + side + '-' + st.selectedIdx,
                id: 'genre-' + side + '-' + st.selectedIdx,
                name: (variant ? variant.name : 'Genre') + ' Target',
                role: 'target',
                color: side === 'music' ? '#2563eb' : '#f59e0b',
                visible: true,
                data: data
            });

            this.closeGenreTargetPicker(side);
            PEQDB_Module.updateAll();
            PEQDB_Module.generateLeastSquaresAutoEQ();
        },

                getLiveAdvancedFiltersState: function() {
if (window.bypassedBands === undefined) window.bypassedBands = new Set();
const adv = this.advancedBands.map((b, i) => {
                    const fEl = document.getElementById("eq-af" + i);
                    const sEl = document.getElementById("eq-a" + i);
                    const qEl = document.getElementById("eq-q_a" + i);
                    const isBypassed = window.bypassedBands.has("a" + i);

                    const hzVal = fEl ? parseFloat(fEl.value) : b.hz;
                    let gVal = 0;
                    if (sEl) {
                        gVal = isBypassed ? 0 : parseFloat(sEl.value);
                    } else {
                        gVal = isBypassed ? 0 : (b.g !== undefined ? b.g : 0.0);
                    }
                    const qVal = qEl ? parseFloat(qEl.value) : (b.q !== undefined ? b.q : b.defaultQ);

                    return {
                        hz: hzVal,
                        g: gVal,
                        q: qVal,
                        type: b.type || 'peaking',
                        slope: b.slope || 12
                    };
                });
return adv;
},
getLiveFiltersState: function() {
            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const main = this.bands.map((b, i) => {
                const fEl = document.getElementById("eq-f" + i);
                const sEl = document.getElementById("eq-s" + i);
                const qEl = document.getElementById("eq-q_m" + i);
                const isBypassed = window.bypassedBands.has("m" + i);
                return {
                    hz: fEl ? parseFloat(fEl.value) : b.hz,
                    g: (isBypassed || !sEl) ? 0 : parseFloat(sEl.value),
                    q: qEl ? parseFloat(qEl.value) : b.defaultQ,
                    type: b.type || 'peaking',
                    slope: b.slope || 12
                };
            });
            return { main };
        },
                getRealValues: function() {
            const preValEl = document.getElementById("eq-preampVal");
            const preVal = preValEl ? parseFloat(preValEl.value) : 0;
            const { main } = this.getLiveFiltersState();
            const adv = this.getLiveAdvancedFiltersState();
            return { preVal, mainVals: main, advVals: adv };
        },

        getCompositeFilterMagnitude: function(freqs, numPoints) {
            if (!this.cachedFilterMag || this.cachedFilterMag.length !== numPoints) {
                this.cachedFilterMag = new Float32Array(numPoints);
                this.cachedMagRes = new Float32Array(numPoints);
                this.cachedPhaseRes = new Float32Array(numPoints);
            }
            const filterMag = this.cachedFilterMag;
            const magRes = this.cachedMagRes;
            const phaseRes = this.cachedPhaseRes;

            // Read all mutable state ONCE; the recompute body below reuses these
            // same locals. The graph redraws on every EQ change AND also ~20-60x/s
            // during playback, and before caching this re-evaluated ~20-30 biquad
            // filters over 1000 points on every call even when nothing changed.
            // We only re-run the expensive work when this signature actually differs.
            // Incremental dirty-flag. The graph is re-pulled ~20-60x/s during playback
            // even when the user changes nothing. Rather than re-reading ~20 DOM
            // slider inputs and building a large signature JSON on every call, we
            // bump a cheap counter when any live band/advanced slider fires an
            // `input` event, and compare a small snapshot of the switch-style
            // settings (bypass, de-esser, loudness, crossover, source-sim, tape,
            // virtual bands, sim tip). If nothing changed we return the cached
            // magnitude directly, skipping both the DOM reads and the signature work.
            if (!this._magLiveTrackSetup) {
                this._magLiveTrackSetup = true;
                this._magFiltersVersion = 0;
                const self = this;
                document.addEventListener('input', (e) => {
                    const el = e.target;
                    if (el && el.id && /^(?:eq-q_a|eq-q_m|eq-af|eq-f|eq-s|eq-a)/.test(el.id)) self._magFiltersVersion++;
                }, true);
            }
            const simStrength = parseFloat(document.getElementById('sim-tip-strength')?.value || 100) / 100;
            const loudnessVol = parseFloat(document.getElementById("eq-musicVolumeSlider")?.value || 50);
            // The de-esser notch FOLLOWS the detected sibilance peak in the audio
            // path (updateSimulations index 5 receives deEsserCurrentFreq), so the
            // drawn curve must use the same tracked value — deEsserFilter is a
            // static {frequency:{value:6000}} placeholder that never changes, and
            // keying the cache off it froze both the notch position and the cache.
            const deEsserFreq = Number.isFinite(this.deEsserCurrentFreq)
                ? this.deEsserCurrentFreq
                : ((this.deEsserFilter && this.deEsserFilter.frequency) ? this.deEsserFilter.frequency.value : 6000);
            const bypassSize = window.bypassedBands ? window.bypassedBands.size : -1;
            const masterBassVal = parseFloat(document.getElementById("eq-masterBass")?.value || 0);
            const masterTrebVal = parseFloat(document.getElementById("eq-masterTreble")?.value || 0);
            const hearingCalStr = (this.hearingCalEnabled && this.hearingOffsets) ? this.hearingOffsets.join(',') : 'off';
            const gearIdx = (this.currentGearIdx !== undefined) ? this.currentGearIdx : 0;
            const cheapKey = [simStrength, loudnessVol, Number.isFinite(deEsserFreq) ? +deEsserFreq.toFixed(2) : 0,
                this.deEsserEnabled ? 1 : 0, this.deEsserReductionDb || 0,
                this.loudnessActive ? 1 : 0, this.loudnessCalibrationVol, this.loudnessStrength,
                this.crossoverActive ? 1 : 0, this.crossoverType,
                this.crossoverLowTrim, this.crossoverLowMidTrim, this.crossoverMidTrim,
                this.crossoverHighMidTrim, this.crossoverHighTrim,
                this.crossoverFreq1, this.crossoverFreq2, this.crossoverFreq3, this.crossoverFreq4,
                this.sourceSimLowG, this.sourceSimLowF, this.sourceSimHighG, this.sourceSimHighF,
                this.simState.tip, this.simState.depth, this.simState.seal,
                this.tapeModState ? JSON.stringify(this.tapeModState) : 'n',
                masterBassVal, masterTrebVal, hearingCalStr, gearIdx,
                this.virtualBands ? this.virtualBands.length : -1,
                this.eqEnabled ? 1 : 0].join('|');

            if (this._magCacheNumPoints === numPoints
                && this._magCacheVersion === this._magFiltersVersion
                && this._magCacheBypass === bypassSize
                && this._magCacheCheap === cheapKey) {
                return filterMag;
            }

            this._magCacheVersion = this._magFiltersVersion;
            this._magCacheBypass = bypassSize;
            this._magCacheCheap = cheapKey;
            this._magCacheNumPoints = numPoints;

            const { main: mainState } = this.getLiveFiltersState();
            const advState = this.getLiveAdvancedFiltersState();

            filterMag.fill(1.0);

            // When the EQ is toggled OFF (bypass), the worklet skips the main,
            // advanced and virtual band banks (updateAudioConnections ORs
            // !eqEnabled into every band's bypassed flag) while sims stay
            // audible — mirror exactly that here so the drawn curve matches.
            const includeBands = this.eqEnabled !== false;

            if (includeBands) this.bands.forEach((b, i) => {
                const state = mainState[i];
                const activeType = state.type || 'peaking';
                const hasNoGain = ['highpass', 'lowpass', 'notch'].includes(activeType);
                const rawG = hasNoGain ? 0.0 : state.g;

                // Slope only means anything for Shelf/HP/LP; a stale value
                // left over from a previous type must not cascade multiple
                // full-gain copies of a Peaking/Notch section (matches the
                // same guard in updateAudioConnections()).
                const slopeCapableForCascade = (activeType === 'lowshelf' || activeType === 'highshelf' || activeType === 'lowpass' || activeType === 'highpass');
                const activeSlope = slopeCapableForCascade ? (b.slope || 12) : 12;
                const cascadeNodesCount = Math.max(1, Math.round(activeSlope / 12));

                // Native BiquadFilterNode ignores Q for lowshelf/highshelf
                // (fixed slope S=1), while the worklet (dsp-processor.js) and
                // getBiquadMagnitude implement RBJ Q-aware shelf alpha. Evaluate
                // shelves through getBiquadMagnitude with the DSP's [0.3, 3.0]
                // shelfQ clamp so the drawn curve matches what is audible and
                // exported for every shelf Q the UI allows.
                if (activeType === 'lowshelf' || activeType === 'highshelf') {
                    const nodeGain = rawG / cascadeNodesCount;
                    const shelfQ = Math.max(0.3, Math.min(3.0, Number.isFinite(state.q) ? state.q : 1.0));
                    for (let j = 0; j < numPoints; j++) {
                        let m = 1.0;
                        for (let k = 0; k < cascadeNodesCount; k++) {
                            m *= this.getBiquadMagnitude(activeType, freqs[j], state.hz, shelfQ, nodeGain);
                        }
                        filterMag[j] *= m;
                    }
                    return;
                }

                for (let k = 0; k < cascadeNodesCount; k++) {
                    const f = this.mathFilters[i];
                    f.type = activeType;
                    f.frequency.value = state.hz;

                    let nodeGain = rawG;
                    f.gain.value = nodeGain;
                    f.Q.value = state.q;
                    f.getFrequencyResponse(freqs, magRes, phaseRes);
                    for (let j = 0; j < numPoints; j++) {
                        filterMag[j] *= magRes[j];
                    }
                }
            });

            if (includeBands) this.advancedBands.forEach((b, i) => {
                const state = advState[i];
                const advType = state.type || 'peaking';

                // Same shelf-Q parity as the main bands above (custom presets
                // can restore LS/HS types on advanced bands).
                if (advType === 'lowshelf' || advType === 'highshelf') {
                    const advShelfQ = Math.max(0.3, Math.min(3.0, Number.isFinite(state.q) ? state.q : 1.0));
                    for (let j = 0; j < numPoints; j++) {
                        filterMag[j] *= this.getBiquadMagnitude(advType, freqs[j], state.hz, advShelfQ, state.g);
                    }
                    return;
                }

                const f = this.mathFilters[10 + i];
                f.type = advType;
                f.frequency.value = state.hz;
                f.gain.value = state.g;
                f.Q.value = state.q;
                f.getFrequencyResponse(freqs, magRes, phaseRes);
                for(let j = 0; j < numPoints; j++) filterMag[j] *= magRes[j];
            });

            if (includeBands && this.virtualBands) {
                this.virtualBands.forEach((b, i) => {
                    const f = this.mathFilters[20 + i];
                    if (f) {
                        f.type = b.type || 'peaking';
                        f.frequency.value = b.hz;
                        f.gain.value = b.g;
                        f.Q.value = b.q;
                        f.getFrequencyResponse(freqs, magRes, phaseRes);
                        for (let j = 0; j < numPoints; j++) filterMag[j] *= magRes[j];
                    }
                });
            }

            if (this.sourceSimLowG !== undefined && this.sourceSimHighG !== undefined) {
                const simLowF = this.sourceSimLowF || 10;
                const simLowG = this.sourceSimLowG || 0;
                const simHighF = this.sourceSimHighF || 22000;
                const simHighG = this.sourceSimHighG || 0;

                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (simLowG !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, simLowF, 0.7, simLowG);
                    if (simHighG !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, simHighF, 0.7, simHighG);
                }
            }

            if (this.deEsserEnabled && this.deEsserReductionDb !== 0 && this.deEsserFilter) {
                const activeFreq = deEsserFreq;
                for (let j = 0; j < numPoints; j++) {
                    filterMag[j] *= this.getBiquadMagnitude('peaking', freqs[j], activeFreq, 2.5, this.deEsserReductionDb);
                }
            }

            const tip = this.simState.tip;
            const depth = this.simState.depth;
            const seal = this.simState.seal;
            const strength = simStrength;

            for (let j = 0; j < numPoints; j++) {
                const f = freqs[j];
                let simVal = 1.0;

                if (tip === 'foam') {
                    simVal *= this.getBiquadMagnitude('highshelf', f, 6000, 0.7, -3.0 * strength);
                } else if (tip === 'narrow') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 200, 0.7, 2.0 * strength);
                    simVal *= this.getBiquadMagnitude('highshelf', f, 4000, 0.7, -2.5 * strength);
                } else if (tip === 'wide') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -1.5 * strength);
                    simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, 1.5 * strength);
                } else if (tip === 'double') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 7000, 2.5, -4.0 * strength);
                } else if (tip === 'triple') {
                    simVal *= this.getBiquadMagnitude('highshelf', f, 5000, 0.7, -3.5 * strength);
                    simVal *= this.getBiquadMagnitude('peaking', f, 8000, 1.5, -2.0 * strength);
                }

                if (depth === 'shallow') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 6000, 2.0, 3.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 8500, 2.0, -4.0);
                } else if (depth === 'deep') {
                    simVal *= this.getBiquadMagnitude('peaking', f, 8000, 2.0, -4.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 11500, 1.5, 4.0);
                }

                if (seal === 'good') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 80, 0.7, -2.5);
                } else if (seal === 'loose') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 150, 0.7, -9.0);
                } else if (seal === 'broken') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, -18.0);
                }

                const tapeMode = this.tapeModState;
                if (tapeMode === 'front') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 120, 0.7, 6.0);
                    simVal *= this.getBiquadMagnitude('peaking', f, 35, 1.2, 2.5);
                } else if (tapeMode === 'rear') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 250, 0.7, 3.5);
                    simVal *= this.getBiquadMagnitude('peaking', f, 150, 1.0, 2.0);
                } else if (tapeMode === 'full') {
                    simVal *= this.getBiquadMagnitude('lowshelf', f, 180, 0.8, 8.5);
                    simVal *= this.getBiquadMagnitude('peaking', f, 30, 1.5, 4.0);
                }

                filterMag[j] *= simVal;
            }

            if (this.gearSimOptions && this.gearSimOptions[gearIdx]) {
                const gear = this.gearSimOptions[gearIdx];
                if (gear.lowG !== 0 || gear.highG !== 0) {
                    for (let j = 0; j < numPoints; j++) {
                        const f = freqs[j];
                        if (gear.lowG !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, gear.lowF, 0.7, gear.lowG);
                        if (gear.highG !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, gear.highF, 0.7, gear.highG);
                    }
                }
            }

            if (masterBassVal !== 0 || masterTrebVal !== 0) {
                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (masterBassVal !== 0) filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 105, 0.7, masterBassVal);
                    if (masterTrebVal !== 0) filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 8000, 0.7, masterTrebVal);
                }
            }

            if (this.hearingCalEnabled && this.hearingOffsets && this.hearingCalibrationFrequencies) {
                const hFreqs = this.hearingCalibrationFrequencies;
                for (let k = 0; k < hFreqs.length; k++) {
                    const hGain = this.hearingOffsets[k] || 0;
                    if (hGain !== 0) {
                        const hf = hFreqs[k];
                        for (let j = 0; j < numPoints; j++) {
                            // Q must match the worklet sim (eq-hearing-cal.js q:1.0)
                            // and the exports (Q 1.00) or the drawn curve would be
                            // narrower than what the user actually hears.
                            filterMag[j] *= this.getBiquadMagnitude('peaking', freqs[j], hf, 1.0, hGain);
                        }
                    }
                }
            }

            if (this.loudnessActive) {
                const currentVol = loudnessVol;
                const volumeDiff = Math.max(0, this.loudnessCalibrationVol - currentVol);
                const norm = volumeDiff / 100;
                const bassBoost = 14.0 * Math.pow(norm, 0.6) * (this.loudnessStrength / 100);
                const trebleBoost = 8.0 * Math.pow(norm, 0.65) * (this.loudnessStrength / 100);

                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];
                    if (bassBoost !== 0) {
                        filterMag[j] *= this.getBiquadMagnitude('lowshelf', f, 100, 0.7, bassBoost);
                    }
                    if (trebleBoost !== 0) {
                        filterMag[j] *= this.getBiquadMagnitude('highshelf', f, 7500, 0.7, trebleBoost);
                    }
                }
            }

            if (this.crossoverActive) {
                const type = this.crossoverType;
                const lLin = Math.pow(10, this.crossoverLowTrim / 20);
                const lmLin = Math.pow(10, this.crossoverLowMidTrim / 20);
                const mLin = Math.pow(10, this.crossoverMidTrim / 20);
                const hmLin = Math.pow(10, this.crossoverHighMidTrim / 20);
                const hLin = Math.pow(10, this.crossoverHighTrim / 20);

                for (let j = 0; j < numPoints; j++) {
                    const f = freqs[j];

                    const lowCutFreq = type === '5way' ? this.crossoverFreq1 : (type === '2way' ? this.crossoverFreq3 : this.crossoverFreq2);
                    const magL = Math.pow(this.getBiquadMagnitude('lowpass', f, lowCutFreq, 0.707, 0), 2) * lLin;

                    let magLM = 0;
                    if (type === '5way') {
                        magLM = Math.pow(this.getBiquadMagnitude('highpass', f, this.crossoverFreq1, 0.707, 0), 2) *
                                Math.pow(this.getBiquadMagnitude('lowpass', f, this.crossoverFreq2, 0.707, 0), 2) * lmLin;
                    }

                    let magM = 0;
                    if (type === '3way' || type === '4way' || type === '5way') {
                        magM = Math.pow(this.getBiquadMagnitude('highpass', f, this.crossoverFreq2, 0.707, 0), 2) *
                               Math.pow(this.getBiquadMagnitude('lowpass', f, this.crossoverFreq3, 0.707, 0), 2) * mLin;
                    }

                    let magHM = 0;
                    if (type === '4way' || type === '5way') {
                        magHM = Math.pow(this.getBiquadMagnitude('highpass', f, this.crossoverFreq3, 0.707, 0), 2) *
                                Math.pow(this.getBiquadMagnitude('lowpass', f, this.crossoverFreq4, 0.707, 0), 2) * hmLin;
                    }

                    const highCutFreq = type === '2way' ? this.crossoverFreq3 : (type === '3way' ? this.crossoverFreq3 : this.crossoverFreq4);
                    const magH = Math.pow(this.getBiquadMagnitude('highpass', f, highCutFreq, 0.707, 0), 2) * hLin;

                    const sumMag = magL + magLM + magM + magHM + magH;
                    filterMag[j] *= sumMag;
                }
            }

            return filterMag;
        },

        loadValues: function(eqData) {
            if (!eqData) return;

            EQ_Module.isProgrammaticSliderUpdate = true;

            const { preVal, mainVals } = eqData;

            if (preVal !== undefined) {
                const preValEl = document.getElementById("eq-preampVal");
                const preSlider = document.getElementById("eq-preampSlider");
                if (preValEl) preValEl.value = preVal.toFixed(1);
                if (preSlider) preSlider.value = Math.max(-20, Math.min(20, preVal));
                if (this.preampNode) setAudioParamSmooth(this.preampNode.gain, Math.pow(10, preVal / 20));
                this.updatePreamp();
            }

            if (mainVals) {
                mainVals.forEach((v, i) => {
                    if (i < this.bands.length) {
                        const b = this.bands[i];
                        const hz = v.hz !== undefined ? v.hz : b.hz;
                        const g = v.g !== undefined ? v.g : 0.0;
                        const q = v.q !== undefined ? v.q : b.defaultQ;
                        const type = v.type || 'peaking';

                        b.type = type;

                        const fInput = document.getElementById("eq-f" + i);
                        const fsSlider = document.getElementById(`eq-fs_m${i}`);
                        const sSlider = document.getElementById("eq-s" + i);
                        const sNum = document.getElementById(`eq-s${i}_num`);
                        const qSlider = document.getElementById("eq-q_m" + i);
                        const qNum = document.getElementById(`eq-q_m${i}_num`);
                        const typeBtn = document.getElementById(`eq-t_m${i}`);

                        if (fInput) fInput.value = hz;
                        if (fsSlider) fsSlider.value = this.logHzToSlider(hz);
                        if (sSlider) sSlider.value = Math.max(-20, Math.min(20, g));
                        if (sNum) sNum.value = g.toFixed(1);
                        if (qSlider) qSlider.value = Math.max(0.1, Math.min(10, q));
                        if (qNum) qNum.value = q.toFixed(2);

                        if (typeBtn) {
                            const labelMap = { peaking: 'PK', lowshelf: 'LS', highshelf: 'HS', highpass: 'HP', lowpass: 'LP', notch: 'Notch' };
                            typeBtn.textContent = labelMap[type] || 'PK';
                        }

                        if (this.filters[i]) {
                            this.filters[i].type = type;
                            setAudioParamSmooth(this.filters[i].frequency, hz);
                            setAudioParamSmooth(this.filters[i].gain, this.eqEnabled ? g : 0);
                            setAudioParamSmooth(this.filters[i].Q, q);
                        }

                                                this.updateSlider(i);
                    }
                });
            }

            if (eqData.advVals) {
                eqData.advVals.forEach((v, i) => {
                    if (i < this.advancedBands.length) {
                        const b = this.advancedBands[i];
                        b.hz = v.hz !== undefined ? v.hz : b.hz;
                        b.g = v.g !== undefined ? v.g : 0.0;
                        b.q = v.q !== undefined ? v.q : b.defaultQ;
                        b.type = v.type || 'peaking';

                        const fInput = document.getElementById("eq-af" + i);
                        const sSlider = document.getElementById("eq-a" + i);
                        const qSlider = document.getElementById("eq-q_a" + i);

                        if (fInput) fInput.value = b.hz;
                        if (sSlider) sSlider.value = Math.max(-20, Math.min(20, b.g));
                        if (qSlider) qSlider.value = Math.max(0.1, Math.min(10, b.q));

                        this.updateSlider(i, 'adv');
                    }
                });
            }
            this.drawCurve();

            EQ_Module.isProgrammaticSliderUpdate = false;

            // An imported/loaded profile reshaped the DSP curve even though it
            // was applied programmatically — unlock Similar-mode matching.
            PEQDB_Module._similarTargetEverModified = true;

            if (PEQDB_Module.searchMode === 'similar' && PEQDB_Module.debouncedFindSimilarCurves) {
                PEQDB_Module.debouncedFindSimilarCurves();
            }
        },

        getBiquadMagnitude: function(type, f, f0, Q, G, Fs = null) {
            if (G === 0 && (type === 'peaking' || type === 'lowshelf' || type === 'highshelf')) return 1.0;

            const activeFs = Fs || (window.SharedAudio && SharedAudio.ctx ? SharedAudio.ctx.sampleRate : 44100);

            const fClamped = Math.max(1.0, f);
            const w = 2 * Math.PI * fClamped / activeFs;
            const cosW = Math.cos(w);
            const sinW = Math.sin(w);

            // Clamp to 0.45xSR with a >=1 kHz margin from Nyquist. MUST stay
            // identical to BiquadFilter.updateCoefficients (dsp-processor.js):
            // this function draws/exports the response of the filters the
            // worklet actually builds, so both sides must clamp f0 the same
            // way. (At all standard audio rates 0.45xSR binds first; the
            // matching margins keep them aligned at exotic low rates too.)
            const maxF0 = Math.min(activeFs * 0.45, activeFs / 2 - 1000);
            const safeF0 = Math.max(10, Math.min(maxF0, Number.isFinite(f0) ? f0 : 1000));
            const w0 = 2 * Math.PI * safeF0 / activeFs;
            const cosW0 = Math.cos(w0);
            const sinW0 = Math.sin(w0);
            const A = Math.pow(10, G / 40);

            let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

            if (type === 'peaking') {
                const alpha = sinW0 / (2 * Q);
                b0 = 1 + alpha * A;
                b1 = -2 * cosW0;
                b2 = 1 - alpha * A;
                a0 = 1 + alpha / A;
                a1 = -2 * cosW0;
                a2 = 1 - alpha / A;
            } else if (type === 'lowshelf') {
                const alpha = (typeof CurveUtils !== 'undefined' && CurveUtils.computeShelfAlpha)
                    ? CurveUtils.computeShelfAlpha(sinW0, A, Q)
                    : (sinW0 / 2) * Math.sqrt(Math.max(0.02, (A + 1 / A) * (1 / Math.max(0.3, Math.min(3.0, Number.isFinite(Q) ? Q : 1.0)) - 1) + 2));

                b0 = A * ((A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
                b2 = A * ((A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = -2 * ((A - 1) + (A + 1) * cosW0);
                a2 = (A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
            } else if (type === 'highshelf') {
                const alpha = (typeof CurveUtils !== 'undefined' && CurveUtils.computeShelfAlpha)
                    ? CurveUtils.computeShelfAlpha(sinW0, A, Q)
                    : (sinW0 / 2) * Math.sqrt(Math.max(0.02, (A + 1 / A) * (1 / Math.max(0.3, Math.min(3.0, Number.isFinite(Q) ? Q : 1.0)) - 1) + 2));

                b0 = A * ((A + 1) + (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha);
                b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
                b2 = A * ((A + 1) + (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha);
                a0 = (A + 1) - (A - 1) * cosW0 + 2 * Math.sqrt(A) * alpha;
                a1 = 2 * ((A - 1) - (A + 1) * cosW0);
                a2 = (A + 1) - (A - 1) * cosW0 - 2 * Math.sqrt(A) * alpha;
            } else if (type === 'lowpass') {
                const alpha = sinW0 / (2 * Q);
                b0 = (1 - cosW0) / 2;
                b1 = 1 - cosW0;
                b2 = (1 - cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else if (type === 'highpass') {
                const alpha = sinW0 / (2 * Q);
                b0 = (1 + cosW0) / 2;
                b1 = -(1 + cosW0);
                b2 = (1 + cosW0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else if (type === 'notch') {
                const alpha = sinW0 / (2 * Q);
                b0 = 1;
                b1 = -2 * cosW0;
                b2 = 1;
                a0 = 1 + alpha;
                a1 = -2 * cosW0;
                a2 = 1 - alpha;
            } else {
                return 1.0;
            }

            const nB0 = b0 / a0, nB1 = b1 / a0, nB2 = b2 / a0;
            const nA1 = a1 / a0, nA2 = a2 / a0;

            const cos2W = cosW * cosW - sinW * sinW;
            const sin2W = 2 * sinW * cosW;

            const numReal = nB0 + nB1 * cosW + nB2 * cos2W;
            const numImag = -(nB1 * sinW + nB2 * sin2W);
            const numMag2 = numReal * numReal + numImag * numImag;

            const denReal = 1 + nA1 * cosW + nA2 * cos2W;
            const denImag = -(nA1 * sinW + nA2 * sin2W);
            const denMag2 = denReal * denReal + denImag * denImag;

            return Math.sqrt(numMag2 / Math.max(1e-12, denMag2));
        },

        // hzToX/xToHz/dbToY/yToDb/getFilterAtCoords were removed here: they
        // referenced a canvas ID (#eq-largeResponseViz) that doesn't exist
        // anywhere in index.html, had zero callers outside this cluster,
        // and used hardcoded 980x320 canvas dimensions that don't match
        // the real EQ graph canvas (#eq-squiglinkViz, which is DPR-scaled
        // and dynamically sized). The live hit-testing path is the
        // closure-scoped getEQNodeAtCoords used by the graph's own
        // mouse/touch handlers -- this was an orphaned duplicate, not a
        // second code path anything depended on.

        updateMusicMatch: function() {
            const faders = [];
            for (let i = 0; i < 10; i++) {
                const el = document.getElementById('eq-s' + i);
                faders.push(el ? parseFloat(el.value) : 0.0);
            }

            const totalAbs = faders.reduce((sum, v) => sum + Math.abs(v), 0);
            if (totalAbs < 1.5) {
                this.setMusicMatchUI("🚫", "No Match", "text-zinc-500", "anim-match-breath");
                return;
            }

            const bestMatch = FindEngine.determineLiveMusicGenreMatch(faders, this.activePreset);
            this.setMusicMatchUI(bestMatch.emoji, bestMatch.name, bestMatch.colorClass, bestMatch.animClass);
        },
        setMusicMatchUI: function(emoji, label, colorClass, animClass) {
            // Runs from the graph draw path (~20-60x/s with the spectrum
            // overlay active); skip every DOM write while the badge is unchanged.
            const sig = emoji + '|' + label + '|' + colorClass + '|' + animClass;
            if (this._musicMatchSig === sig) return;
            this._musicMatchSig = sig;
            const emojiContainer = document.getElementById('music-match-emoji-container');
            const textContainer = document.getElementById('music-match-genre-text');

            if (emojiContainer) {
                const fx = (FindEngine.pickFx || {})[label] || '';
                const prevFx = this._musicFxKey;
                this._musicFxKey = fx;
                emojiContainer.innerHTML = `<span class="fx-play ${animClass}" data-fx="${fx}" style="display: inline-block; position: relative; transform-origin: center;"><span class="emoji-font vibrant-emoji leading-none" style="display: inline-block; transform-origin: center;">${emoji}</span></span>`;
                const fxEl = emojiContainer.firstElementChild;
                if (fx && fxEl) {
                    if (fx === prevFx) {
                        fxEl.classList.remove('fx-play');
                    } else {
                        const ms = (parseFloat(getComputedStyle(fxEl).animationDuration) || 0) * 1000 + 80;
                        setTimeout(() => { if (fxEl.isConnected) fxEl.classList.remove('fx-play'); }, ms);
                    }
                }
            }
            if (textContainer) {
                textContainer.textContent = label;
                textContainer.className = `text-[10px] font-black leading-tight ${colorClass} ${animClass}`;
                textContainer.style.display = "inline-block";
                textContainer.style.transformOrigin = "left center";
            }
        },
        setGameMatchUI: function(emoji, label, colorClass, animClass) {
            const sig = emoji + '|' + label + '|' + colorClass + '|' + animClass;
            if (this._gameMatchSig === sig) return;
            this._gameMatchSig = sig;
            const emojiContainer = document.getElementById('game-match-emoji-container');
            const textContainer = document.getElementById('game-match-genre-text');

            if (emojiContainer) {
                const fx = (FindEngine.pickFx || {})[label] || '';
                const prevFx = this._gameFxKey;
                this._gameFxKey = fx;
                emojiContainer.innerHTML = `<span class="fx-play ${animClass}" data-fx="${fx}" style="display: inline-block; position: relative; transform-origin: center;"><span class="emoji-font vibrant-emoji leading-none" style="display: inline-block; transform-origin: center;">${emoji}</span></span>`;
                const fxEl = emojiContainer.firstElementChild;
                if (fx && fxEl) {
                    if (fx === prevFx) {
                        fxEl.classList.remove('fx-play');
                    } else {
                        const ms = (parseFloat(getComputedStyle(fxEl).animationDuration) || 0) * 1000 + 80;
                        setTimeout(() => { if (fxEl.isConnected) fxEl.classList.remove('fx-play'); }, ms);
                    }
                }
            }
            if (textContainer) {
                textContainer.textContent = label;
                textContainer.className = `text-[10px] font-black leading-tight ${colorClass} ${animClass}`;
                textContainer.style.display = "inline-block";
                textContainer.style.transformOrigin = "left center";
            }
        },
        updateGameMatch: function() {
            const faders = [];
            for (let i = 0; i < 10; i++) {
                const el = document.getElementById('eq-s' + i);
                faders.push(el ? parseFloat(el.value) : 0.0);
            }

            const totalAbs = faders.reduce((sum, v) => sum + Math.abs(v), 0);
            if (totalAbs < 1.5) {
                this.setGameMatchUI("🚫", "No Match", "text-zinc-500", "anim-match-breath");
                return;
            }

            const bestMatch = FindEngine.determineLiveGameGenreMatch(faders, this.activePreset);
            this.setGameMatchUI(bestMatch.emoji, bestMatch.name, bestMatch.colorClass, bestMatch.animClass);
        },

        changeGraphMode: function(mode) {
            this.graphMode = mode;

            const optIdx = this.graphModes.findIndex(m => m.id === mode);
            if (optIdx !== -1) {
                this.currentGraphModeIdx = optIdx;
                const btn = document.getElementById('graph-mode-cycle-btn');
                if (btn) btn.textContent = this.graphModes[optIdx].label;
            }

            this.drawCurve();
        },

toggleVizFullscreen: function() {
            const modal = document.getElementById('fullscreen-viz-modal');
            const trackName = document.getElementById('modal-track-name');
            const modalPlayBtn = document.getElementById('modal-play-btn');

            if (!modal) return;

            this.vizModalActive = !this.vizModalActive;

            if (this.vizModalActive) {

                this.ensureDSPGraph();

                modal.classList.remove('hidden');
                modal.classList.add('flex');

                const currentTrackInfo = document.getElementById('playlist-track-info')?.textContent || "No tracks Loaded";
                if (trackName) trackName.textContent = currentTrackInfo;

                if (modalPlayBtn) {
                    modalPlayBtn.innerHTML = this.audioEl.paused ? "<span>▶️</span><span>Play</span>" : "<span>⏸️</span><span>Pause</span>";
                }

                if (!this.vizLoopRunning) {
                    this.startVisualizer();
                }
            } else {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        },

                calculateTargetMatches: function() {

            this.updateMusicMatch();
            this.updateGameMatch();
        },

startVisualizer: function() {
        if (this.vizFrameId) {
            cancelAnimationFrame(this.vizFrameId);
            this.vizFrameId = null;
        }
        if (this.vizLoopRunning) return;

        if (!this.agcIntervalId) {

            let agcArrayL = new Uint8Array(SharedAudio.analyserL ? SharedAudio.analyserL.frequencyBinCount : 2048);
            let agcArrayR = new Uint8Array(SharedAudio.analyserR ? SharedAudio.analyserR.frequencyBinCount : 2048);
            this.agcIntervalId = setInterval(() => {
                if (document.hidden) return;
                if (EQ_Module.preventClipping && SharedAudio.ctx && SharedAudio.analyserL && SharedAudio.analyserR) {

                    if (agcArrayL.length !== SharedAudio.analyserL.frequencyBinCount) {
                        agcArrayL = new Uint8Array(SharedAudio.analyserL.frequencyBinCount);
                    }
                    if (agcArrayR.length !== SharedAudio.analyserR.frequencyBinCount) {
                        agcArrayR = new Uint8Array(SharedAudio.analyserR.frequencyBinCount);
                    }
                    const arrayL = agcArrayL;
                    const arrayR = agcArrayR;
                    SharedAudio.analyserL.getByteTimeDomainData(arrayL);
                    SharedAudio.analyserR.getByteTimeDomainData(arrayR);

                    let maxL = 0, maxR = 0;
                    for (let i = 0; i < arrayL.length; i++) {
                        const valL = Math.abs(arrayL[i] - 128);
                        const valR = Math.abs(arrayR[i] - 128);
                        if (valL > maxL) maxL = valL;
                        if (valR > maxR) maxR = valR;
                    }

                    const pctL = (maxL / 128) * 100;
                    const pctR = (maxR / 128) * 100;
                    const peakLevel = Math.max(pctL, pctR);

                    if (peakLevel > 94.0) {
                        const excessDb = 20 * Math.log10(peakLevel / 93.0);
                        if (excessDb > 0.1) {
                            const preampSlider = document.getElementById("eq-preampSlider");
                            if (preampSlider) {
                                const currentPreamp = parseFloat(preampSlider.value) || 0;
                                const newPreamp = Math.max(-20, currentPreamp - excessDb);

                                preampSlider.value = newPreamp.toFixed(1);
                                window.isProgrammaticPreampUpdate = true;
                                EQ_Module.updatePreamp();
                                window.isProgrammaticPreampUpdate = false;
                            }
                        }
                    }
                }
            }, 30);
        }

        this.particleArray = [];
            for (let i = 0; i < 220; i++) {
                this.particleArray.push({
                    x: Math.random() * 1200,
                    y: Math.random() * 800,
                    size: Math.random() * 3 + 1.0,
                    speedX: Math.random() * 1.5 - 0.75,
                    speedY: Math.random() * -2.5 - 0.5,
                    hue: Math.random() * 360,
                    alpha: Math.random() * 0.4 + 0.4
                });
            }

            const miniCanvas = document.getElementById("mini-spectrum");
            const miniCtx = miniCanvas ? miniCanvas.getContext("2d") : null;

            const vintagePeaks = new Float32Array(256).fill(0);
            let liquidPhase = 0;

            let cachedBarsL = null, cachedBarsR = null;
            let cachedPeaksL = null, cachedPeaksR = null;
            let cachedClips = null;

            const refreshVizDomCache = () => {
                cachedBarsL = document.getElementsByClassName('meter-bar-l-vu-vu');
                cachedBarsR = document.getElementsByClassName('meter-bar-r-vu-vu');
                cachedPeaksL = document.getElementsByClassName('meter-bar-l-peak-hold');
                cachedPeaksR = document.getElementsByClassName('meter-bar-r-peak-hold');
                cachedClips = document.getElementsByClassName('vu-meter-clipping-text');
            };

            const drawViz = () => {
                if (!cachedBarsL || cachedBarsL.length === 0) {
                    refreshVizDomCache();
                }

                const activeEl = (typeof this._activeEl === 'function' ? this._activeEl() : null) || this.audioEl;
                const isSoundActive = (activeEl && !activeEl.paused) ||
                                     (this.gaplessEl && !this.gaplessEl.paused) ||
                                     (window.Tone && Tone.osc) ||
                                     (window.TestLab && (TestLab.activeNodes.length > 0 || TestLab.hearingOsc || TestLab.channelToneOsc));

                if (!isSoundActive) {
                // Keep loop alive at low polling rate instead of killing it — killing required a
                // future play event to restart, but a gap between tracks or a brief pause during
                // crossfade could strand the visualizer blank until manual pause/unpause.
                const barsL = document.getElementsByClassName('meter-bar-l-vu-vu');
                const barsR = document.getElementsByClassName('meter-bar-r-vu-vu');
                for (let i = 0; i < barsL.length; i++) barsL[i].style.width = "0%";
                for (let i = 0; i < barsR.length; i++) barsR[i].style.width = "0%";
                const peaksL = document.getElementsByClassName('meter-bar-l-peak-hold');
                const peaksR = document.getElementsByClassName('meter-bar-r-peak-hold');
                for (let i = 0; i < peaksL.length; i++) peaksL[i].style.left = "0%";
                for (let i = 0; i < peaksR.length; i++) peaksR[i].style.left = "0%";
                this.peakL = 0;
                this.peakR = 0;
                const imbalanceL = document.getElementById('imbalance-meter-l');
                const imbalanceR = document.getElementById('imbalance-meter-r');
                if (imbalanceL) imbalanceL.style.width = "0%";
                if (imbalanceR) imbalanceR.style.width = "0%";
                this.meterCurrentL = 0;
                this.meterCurrentR = 0;
                // Throttle idle polling to 10 Hz instead of 60 Hz to save CPU while silent,
                // but keep vizLoopRunning true so tab switch while music playing never sees a dead loop.
                this.vizLoopRunning = true;
                if (this._vizIdleTimer) clearTimeout(this._vizIdleTimer);
                this._vizIdleTimer = setTimeout(() => {
                    this.vizFrameId = requestAnimationFrame(drawViz);
                }, 100);
                return;
            }

            this.vizLoopRunning = true;
            if (this._vizIdleTimer) { clearTimeout(this._vizIdleTimer); this._vizIdleTimer = null; }
            this.vizFrameId = requestAnimationFrame(drawViz);

            // While the user is scrubbing/dragging a slider, skip the heavy
            // viz work on most frames so the drag keeps its frame budget;
            // meters freeze imperceptibly (decay smoothing hides ~30ms gaps).
            if (this.isSeeking) {
                const nowMs = performance.now();
                if (this._vizSeekThrottle === undefined || nowMs - this._vizSeekThrottle >= 34) {
                    this._vizSeekThrottle = nowMs;
                } else {
                    return;
                }
            } else {
                this._vizSeekThrottle = undefined;
            }

                const bufferLength = SharedAudio.analyser ? SharedAudio.analyser.frequencyBinCount : 1024;
                if (!this.cachedDataArray || this.cachedDataArray.length !== bufferLength) {
                    this.cachedDataArray = new Uint8Array(bufferLength);
                    this.cachedTimeDomain = new Uint8Array(bufferLength);
                }
                const dataArray = this.cachedDataArray;
                const timeDomain = this.cachedTimeDomain;

                let hasData = false;
                if (SharedAudio.analyser) {
                    SharedAudio.analyser.getByteFrequencyData(dataArray);
                    SharedAudio.analyser.getByteTimeDomainData(timeDomain);

                    const threshold = 5;
                    for (let i = 0; i < bufferLength; i++) {
                        if (dataArray[i] > threshold || Math.abs(timeDomain[i] - 128) > threshold) {
                            hasData = true;
                            break;
                        }
                    }
                }

                if (!this.previousDataArray || this.previousDataArray.length !== bufferLength) {
                    this.previousDataArray = new Uint8Array(bufferLength);
                }

                if (hasData) {
                this.previousDataArray.set(dataArray);
            }

                if (this.showSpectrumOverlay) {
                    this.drawCurve();
                }

                if (!hasData) {
                    const time = Date.now() * 0.0025;
                    for (let i = 0; i < bufferLength; i++) {
                        timeDomain[i] = 128 + Math.sin(i * 0.035 + time) * 30 * Math.sin(time * 0.2);

                        const weight = Math.pow((i / bufferLength), 1.5);
                        const baseValue = 45 + Math.sin(i * 0.06 - time) * 20;
                        const freqResponse = Math.sin(i * 0.035 + time) * 30 * Math.sin(time * 0.2);

                        dataArray[i] = Math.max(0, baseValue * (1 - weight) + freqResponse * weight);
                    }
                }

            if (SharedAudio.analyserL && SharedAudio.analyserR) {
                const binCountL = SharedAudio.analyserL.frequencyBinCount;
                const binCountR = SharedAudio.analyserR.frequencyBinCount;
                if (!this.cachedArrayL || this.cachedArrayL.length !== binCountL) {
                    this.cachedArrayL = new Uint8Array(binCountL);
                }
                if (!this.cachedArrayR || this.cachedArrayR.length !== binCountR) {
                    this.cachedArrayR = new Uint8Array(binCountR);
                }
                const arrayL = this.cachedArrayL;
                const arrayR = this.cachedArrayR;
                SharedAudio.analyserL.getByteTimeDomainData(arrayL);
                SharedAudio.analyserR.getByteTimeDomainData(arrayR);

                let maxL = 0, maxR = 0;
                for (let i = 0; i < arrayL.length; i++) {
                    const valL = Math.abs(arrayL[i] - 128);
                    const valR = Math.abs(arrayR[i] - 128);
                    if (valL > maxL) maxL = valL;
                    if (valR > maxR) maxR = valR;
                }

                let pctL = (maxL / 128) * 100;
                let pctR = (maxR / 128) * 100;
                if (pctL < 1.0) pctL = 0;
                if (pctR < 1.0) pctR = 0;

                if (this.meterCurrentL === undefined) this.meterCurrentL = 0;
                if (this.meterCurrentR === undefined) this.meterCurrentR = 0;

                const decayFactor = 0.92;
                this.meterCurrentL = (this.meterCurrentL || 0) * decayFactor + pctL * (1 - decayFactor);
                this.meterCurrentR = (this.meterCurrentR || 0) * decayFactor + pctR * (1 - decayFactor);

                if (isNaN(this.meterCurrentL)) this.meterCurrentL = 0;
                if (isNaN(this.meterCurrentR)) this.meterCurrentR = 0;

                if (this.meterCurrentL < 0.5) this.meterCurrentL = 0;
                if (this.meterCurrentR < 0.5) this.meterCurrentR = 0;

                const diffL = Math.abs(this.meterCurrentL - (this.lastMeterL || 0));
                const diffR = Math.abs(this.meterCurrentR - (this.lastMeterR || 0));

                if (diffL > 0.4) {
                    this.lastMeterL = this.meterCurrentL;
                    const barsL = document.getElementsByClassName('meter-bar-l-vu-vu');
                    const targetWidth = this.meterCurrentL.toFixed(1) + "%";
                    for (let i = 0; i < barsL.length; i++) {
                        barsL[i].style.width = targetWidth;
                    }
                }
if (diffR > 0.4) {
                    this.lastMeterR = this.meterCurrentR;
                    const barsR = document.getElementsByClassName('meter-bar-r-vu-vu');
                    const targetWidth = this.meterCurrentR.toFixed(1) + "%";
                    for (let i = 0; i < barsR.length; i++) {
                        barsR[i].style.width = targetWidth;
                    }
                }

                const curTime = Date.now();
                const holdDuration = 1000;
                const decaySpeed = 1.2;

                if (this.meterCurrentL >= (this.peakL || 0)) {
                    this.peakL = this.meterCurrentL;
                    this.peakTimeL = curTime;
                } else {
                    if (curTime - (this.peakTimeL || 0) > holdDuration) {
                        this.peakL = Math.max(0, this.peakL - decaySpeed);
                    }
                }

                if (this.meterCurrentR >= (this.peakR || 0)) {
                    this.peakR = this.meterCurrentR;
                    this.peakTimeR = curTime;
                } else {
                    if (curTime - (this.peakTimeR || 0) > holdDuration) {
                        this.peakR = Math.max(0, this.peakR - decaySpeed);
                    }
                }

                const peaksHoldL = document.getElementsByClassName('meter-bar-l-peak-hold');
                const targetPeakLeft = this.peakL.toFixed(1) + "%";
                for (let i = 0; i < peaksHoldL.length; i++) {
                    peaksHoldL[i].style.left = targetPeakLeft;
                }

                const peaksHoldR = document.getElementsByClassName('meter-bar-r-peak-hold');
                const targetPeakRight = this.peakR.toFixed(1) + "%";
                for (let i = 0; i < peaksHoldR.length; i++) {
                    peaksHoldR[i].style.left = targetPeakRight;
                }

                const currentAutoGain = (SharedAudio.autoGainNode) ? SharedAudio.autoGainNode.gain.value : 1.0;
                const reductionDb = 20 * Math.log10(currentAutoGain);
                const isAttenuationActive = (reductionDb < -0.15);

                const clippingTexts = document.getElementsByClassName('vu-meter-clipping-text');
                for (let i = 0; i < clippingTexts.length; i++) {
                    const el = clippingTexts[i];

                    // Only swap the state classes — never replace className, or the
                    // fixed width (w-16 / min-w-[64px]) gets stripped and the footer
                    // right group reflows (scrub + peak meter jump right).
                    el.classList.remove('text-emerald-400', 'text-amber-500', 'text-rose-500', 'animate-pulse', 'cursor-pointer');

                    if (isAttenuationActive) {
                        el.textContent = `${reductionDb.toFixed(1)} dB`;
                        el.classList.add('text-amber-500', 'animate-pulse', 'cursor-pointer');
                        el.title = "Anti-Clip AGC active. Automatically maintaining headroom.";
                    } else {
                        el.title = "";
                        if (this.meterCurrentL > 94 || this.meterCurrentR > 94) {
                            el.textContent = "⚡ Clipping";
                            el.classList.add('text-rose-500', 'animate-pulse');
                        } else if (this.meterCurrentL > 75 || this.meterCurrentR > 75) {
                            el.textContent = "⚠️ Warning";
                            el.classList.add('text-amber-500');
                        } else {
                            el.textContent = "Stable";
                            el.classList.add('text-emerald-400');
                        }
                    }
                }
            }

                if (isSoundActive && !Mascot.isGeniusActive && !Mascot.isOverrideActive && Mascot.currentExpression !== 'deaf' && Mascot.currentExpression !== 'mute' && !(window.TestLab && (TestLab.leakTestActive || TestLab.channelToneOsc || TestLab.resonanceActive || TestLab.hearingOsc)) && !(window.Tone && Tone.osc)) {

                    if (Mascot.currentExpression !== 'vibing') {
                        Mascot.setExpression('vibing');
                    }

                    var overallVolume = getBandEnergy(dataArray, 0, 256);
                    var intensity = Math.min(1, overallVolume * 1.6);
                    Mascot.applyReactiveAnimation('vibing', intensity);
                }

                if (this.deEsserEnabled) {

                    let midSum = 0;
                    // FFT-bin geometry must be derived from the live context.
                    // The old hardcoded values (23/93/186/372, binWidth 21.53)
                    // assumed 44.1 kHz + fftSize 2048; at 48 kHz they shifted the
                    // scan window to ~4.4-8.7 kHz and mislocated sibilance peaks
                    // by ~9% (bin 280 is 6563 Hz real vs 6028 Hz computed).
                    // These formulas reproduce the old bins exactly at 44.1 kHz:
                    // round(500/21.53)=23, round(2000/21.53)=93,
                    // round(4000/21.53)=186, round(8000/21.53)=372.
                    const deEsserSr = (SharedAudio.ctx && SharedAudio.ctx.sampleRate) || 44100;
                    const deEsserFft = (SharedAudio.analyser && SharedAudio.analyser.fftSize) || 2048;
                    const binWidth = deEsserSr / deEsserFft;
                    const midStartBin = Math.max(1, Math.round(500 / binWidth));
                    const midEndBin = Math.min(dataArray.length - 1, Math.round(2000 / binWidth));
                    for (let i = midStartBin; i < midEndBin; i++) {
                        midSum += dataArray[i];
                    }
                    const midAverage = midSum / (midEndBin - midStartBin) / 255;

                    let maxVal = 0;
                    let peakBin = Math.round(6000 / binWidth);
                    const startBin = Math.max(1, Math.round(4000 / binWidth));
                    const endBin = Math.min(dataArray.length - 1, Math.round(8000 / binWidth));
                    for (let i = startBin; i < endBin; i++) {
                        if (dataArray[i] > maxVal) {
                            maxVal = dataArray[i];
                            peakBin = i;
                        }
                    }
                    const sibilancePeak = maxVal / 255;

                    const relativeMargin = 0.08;
                    const isSibilant = (sibilancePeak > (midAverage + relativeMargin)) && (sibilancePeak > 0.12);
                    const lastReduction = this.deEsserReductionDb;
                    // Compare against the PREVIOUS frame's tracked value. The old
                    // source here was the static deEsserFilter placeholder
                    // (always 6000), so once deEsserCurrentFreq settled anywhere
                    // else, freqChanged stayed true every frame and redrew the
                    // full graph at ~60 fps for as long as playback ran.
                    const lastFreq = Number.isFinite(this.deEsserCurrentFreq) ? this.deEsserCurrentFreq : 6000;

                    let targetFreq = 6000;
                    let targetGain = 0;

                    if (isSibilant) {
                        const excess = sibilancePeak - (midAverage + relativeMargin);
                        const scaleFactor = Math.min(1.0, excess * 15.0);
                        const maxClampDb = 15.0;
                        targetGain = -scaleFactor * maxClampDb * (this.deEsserSensitivity / 100);
                        targetFreq = Math.round(peakBin * binWidth);
                    } else {
                        targetGain = 0;
                        targetFreq = 6000;
                    }

                    if (this.deEsserCurrentFreq === undefined) this.deEsserCurrentFreq = 6000;
                    if (this.deEsserCurrentGain === undefined) this.deEsserCurrentGain = 0;

                    this.deEsserCurrentFreq += 0.45 * (targetFreq - this.deEsserCurrentFreq);
                    this.deEsserCurrentGain += 0.70 * (targetGain - this.deEsserCurrentGain);

                    this.deEsserReductionDb = this.deEsserCurrentGain;

                    const gainDiff = Math.abs(this.deEsserReductionDb - (this.lastSentDeEsserGain || 0));
                    const freqDiff = Math.abs(this.deEsserCurrentFreq - (this.lastSentDeEsserFreq || 6000));

                    if (gainDiff > 0.15 || freqDiff > 50) {
                        this.lastSentDeEsserGain = this.deEsserReductionDb;
                        this.lastSentDeEsserFreq = this.deEsserCurrentFreq;

                        if (SharedAudio.workletNode) {
                            SharedAudio.workletNode.port.postMessage({
                                type: 'updateSimulations',
                                sims: [{
                                    index: 5,
                                    bypassed: !this.deEsserEnabled,
                                    filterType: 'peaking',
                                    frequency: this.deEsserCurrentFreq,
                                    gain: this.deEsserReductionDb,
                                    q: 2.5
                                }]
                            });
                        }
                    }

                    const freqChanged = Math.abs(lastFreq - this.deEsserCurrentFreq) > 20;
                    const gainChanged = Math.abs(lastReduction - this.deEsserCurrentGain) > 0.05;

                    if (gainChanged || freqChanged) {
                        this.drawCurve();
                    }
                } else {
                    if (this.deEsserReductionDb !== 0) {
                        this.deEsserReductionDb = 0;

                        if (SharedAudio.workletNode) {
                            SharedAudio.workletNode.port.postMessage({
                                type: 'updateSimulations',
                                sims: [{
                                    index: 5,
                                    bypassed: true,
                                    filterType: 'peaking',
                                    frequency: 6000,
                                    gain: 0,
                                    q: 2.5
                                }]
                            });
                        }
                        this.drawCurve();
                    }
                }

                const modalTimeCur = document.getElementById('modal-time-current');
                const timeCur = document.getElementById('playlist-time-current');
                const scrub = document.getElementById('playlist-scrub');
                const modalScrub = document.getElementById('modal-scrub');
                const timeDur = document.getElementById('playlist-time-duration');
                const modalTimeDur = document.getElementById('modal-time-duration');

                const mainTrackName = document.getElementById("playlist-track-info");
                const modalTrackName = document.getElementById("modal-track-name");
                if (mainTrackName && modalTrackName && modalTrackName.textContent !== mainTrackName.textContent) {
                    modalTrackName.textContent = mainTrackName.textContent;
                }

                const vizActiveEl = (typeof this._activeEl === 'function' ? this._activeEl() : null) || this.audioEl;
                if (vizActiveEl && !this.isSeeking) {
                    const formattedCur = this.formatTime(vizActiveEl.currentTime);
                    const mobTimeCur = document.getElementById('mobile-time-current');
                    const mobScrub = document.getElementById('mobile-scrub');
                    const mobTimeDur = document.getElementById('mobile-time-duration');

                    if (timeCur) timeCur.textContent = formattedCur;
                    if (mobTimeCur) mobTimeCur.textContent = formattedCur;
                    if (modalTimeCur) modalTimeCur.textContent = formattedCur;

                    if (vizActiveEl.duration) {
                        const pct = (vizActiveEl.currentTime / vizActiveEl.duration) * 100;
                        if (scrub) scrub.value = pct;
                        if (mobScrub) mobScrub.value = pct;
                        if (modalScrub) modalScrub.value = pct;

                        const formattedDur = this.formatTime(vizActiveEl.duration);
                        if (timeDur) timeDur.textContent = formattedDur;
                        if (mobTimeDur) mobTimeDur.textContent = formattedDur;
                        if (modalTimeDur) modalTimeDur.textContent = formattedDur;
                    }
                }

                if (miniCtx && miniCanvas) {
                    const mw = miniCanvas.width;
                    const mh = miniCanvas.height;
                    miniCtx.clearRect(0, 0, mw, mh);
                    miniCtx.strokeStyle = "rgba(37, 99, 235, 0.85)";
                    miniCtx.lineWidth = 2.0;
                    miniCtx.beginPath();

                    const step = 16;
                    const sliceWidth = (mw / bufferLength) * step;
                    let x = 0;
                    for (let i = 0; i < bufferLength; i += step) {
                        const v = timeDomain[i] / 128.0;
                        const y = (v * mh) / 2;
                        if (i === 0) miniCtx.moveTo(x, y);
                        else miniCtx.lineTo(x, y);
                        x += sliceWidth;
                    }
                    miniCtx.stroke();
                }

                if (!EQ_Module.fullscreenVizCanvas) {
                    EQ_Module.fullscreenVizCanvas = document.getElementById("fullscreen-viz-canvas");
                    if (EQ_Module.fullscreenVizCanvas) {
                        EQ_Module.fullscreenVizCtx = EQ_Module.fullscreenVizCanvas.getContext("2d");
                    }
                }

                const fcv = EQ_Module.fullscreenVizCanvas;
                const fctx = EQ_Module.fullscreenVizCtx;
                const isVizTabActive = !document.getElementById('pane-visualizer').classList.contains('hidden');

                if ((EQ_Module.vizModalActive || isVizTabActive) && fcv && fctx) {
                    const clientW = fcv.clientWidth || 800;
                    const clientH = fcv.clientHeight || 600;

                    // Internal render resolution: 0.66 (vs 0.75) cuts every custom
                    // effect's fill/path cost ~25-35% with no layout change, at full
                    // rAF rate (no frame skipping).
                    const renderScale = 0.66;
                    const targetW = Math.floor(clientW * renderScale);
                    const targetH = Math.floor(clientH * renderScale);

                    if (fcv.width !== targetW || fcv.height !== targetH) {
                        fcv.width = targetW;
                        fcv.height = targetH;
                    }

                    const w = fcv.width;
                    const h = fcv.height;

                    let subBass = 0;
                    for (let i = 1; i <= 4; i++) subBass += dataArray[i] || 0;
                    subBass = (subBass / 4) / 255;

                    let midrange = 0;
                    let midCount = 0;
                    for (let i = 5; i <= 186; i++) {
                        midrange += dataArray[i] || 0;
                        midCount++;
                    }
                    midrange = (midrange / midCount) / 255;

                    let treble = 0;
                    let trebCount = 0;
                    for (let i = 187; i < bufferLength; i++) {
                        treble += dataArray[i] || 0;
                        trebCount++;
                    }
                    treble = (trebCount > 0 ? (treble / trebCount) : 0) / 255;

                    let totalEnergy = 0;
                    for (let i = 0; i < bufferLength; i++) totalEnergy += dataArray[i];
                    totalEnergy = (totalEnergy / bufferLength) / 255;

                    // Theme lookup + hex→rgb conversion are loop-invariant per
                    // theme. Resolve once and cache; App.setGlobalTheme bumps
                    // _vizThemeDirty so a live theme switch re-resolves on the
                    // next frame instead of paying localStorage + parse costs
                    // at 60 fps.
                    if (!this._vizTheme || this._vizThemeDirty) {
                        const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                        const activeThemeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                        const accent = activeThemeConfig.accent === '#ffffff' ? '#ffffff' : (activeThemeConfig.accent || "#787878");
                        this._vizTheme = { accent: accent, rgb: PEQDB_Module.hexToRgb(accent) };
                        this._vizThemeDirty = false;
                    }
                    const themeAccent = this._vizTheme.accent;
                    const themeRgb = this._vizTheme.rgb;

                    const mode = EQ_Module.vizModes[EQ_Module.vizModeIndex];

                    if (EQ_Module.customEffects && EQ_Module.customEffects[mode]) {
                        try {
                            const bassIntensity = subBass;
                            EQ_Module.customEffects[mode](fctx, dataArray, timeDomain, w, h, themeAccent, bassIntensity, midrange, treble);
                        } catch (err) {
                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);
                        }
                        return;
                    }

                    switch (mode) {
                        case 'oledSpectrum': {

                        fctx.fillStyle = '#000000';
                        fctx.fillRect(0, 0, w, h);

                        const barCount = 48;
                        const barWidth = w / barCount;
                        const rgb = themeRgb;

                        if (!this.vintagePeaks || this.vintagePeaks.length !== barCount) {
                            this.vintagePeaks = new Float32Array(barCount).fill(0);
                        }

                        const gradKey = `${w}-${h}-${themeAccent}`;
                        if (this.lastGradKey !== gradKey || !this.cachedOledGrad) {
                            this.lastGradKey = gradKey;
                            const masterGrad = fctx.createLinearGradient(0, h, 0, 0);
                            masterGrad.addColorStop(0, `rgba(${rgb}, 0.05)`);
                            masterGrad.addColorStop(0.5, `rgba(${rgb}, 0.4)`);
                            masterGrad.addColorStop(1, themeAccent);
                            this.cachedOledGrad = masterGrad;
                        }
                        const masterGrad = this.cachedOledGrad;

                        for (let i = 0; i < barCount; i++) {
                                const dataIdx = Math.floor(Math.pow(i / barCount, 1.4) * (bufferLength * 0.45));
                                const amp = (dataArray[dataIdx] || 0) / 255;
                                const barHeight = amp * h * 0.85;

                                if (barHeight > this.vintagePeaks[i]) {
                                    this.vintagePeaks[i] = barHeight;
                                } else {
                                    this.vintagePeaks[i] = Math.max(0, this.vintagePeaks[i] - 3.0);
                                }

                                fctx.fillStyle = masterGrad;
                                fctx.fillRect(i * barWidth + 1.5, h - barHeight, barWidth - 3, barHeight);

                                fctx.fillStyle = '#ffffff';
                                fctx.fillRect(i * barWidth + 1.5, h - this.vintagePeaks[i] - 4, barWidth - 3, 2);
                            }
                            break;
                        }

                        case 'oscilloscope': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            fctx.strokeStyle = themeAccent;
                            fctx.lineWidth = 2.5;
                            fctx.beginPath();

                            const sliceWidth = w / bufferLength;
                            let x = 0;

                            for (let i = 0; i < bufferLength; i++) {
                                const v = (timeDomain[i] || 128) / 128.0;
                                const y = (v * h) / 2;

                                if (i === 0) fctx.moveTo(x, y);
                                else fctx.lineTo(x, y);

                                x += sliceWidth;
                            }
                            fctx.stroke();
                            break;
                        }

                        case 'acousticTunnel': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            const ringCount = 10;
                            const cx = w / 2;
                            const cy = h / 2;
                            const rgb = themeRgb;
                            const maxRadius = Math.hypot(cx, cy);

                            if (this.tunnelPhase === undefined) this.tunnelPhase = 0;
                            this.tunnelPhase += 0.012 + subBass * 0.035;

                            fctx.save();
                            fctx.lineWidth = 1.8;

                            for (let i = 0; i < ringCount; i++) {
                                const ringRatio = ((i + (this.tunnelPhase % 1)) / ringCount);
                                const radius = ringRatio * maxRadius;

                                const opacity = Math.sin(ringRatio * Math.PI) * (0.2 + midrange * 0.5);

                                fctx.strokeStyle = `rgba(${rgb}, ${opacity})`;
                                fctx.beginPath();

                                const points = 120;
                                if (!this.lutCos || this.lutCos.length !== points + 1) {
                                    this.lutCos = new Float32Array(points + 1);
                                    this.lutSin = new Float32Array(points + 1);
                                    for (let k = 0; k <= points; k++) {
                                        const angle = k * ((Math.PI * 2) / points);
                                        this.lutCos[k] = Math.cos(angle);
                                        this.lutSin[k] = Math.sin(angle);
                                    }
                                }

                                for (let k = 0; k <= points; k++) {

                                    const waveIdx = Math.floor((k % points) * (bufferLength / points));
                                    const waveVal = ((timeDomain[waveIdx] || 128) - 128) / 128.0;

                                    const ripple = waveVal * 45 * ringRatio * (1.0 + subBass * 1.5);

                                    const rx = cx + this.lutCos[k] * (radius + ripple);
                                    const ry = cy + this.lutSin[k] * (radius + ripple);

                                    if (k === 0) fctx.moveTo(rx, ry);
                                    else fctx.lineTo(rx, ry);
                                }
                                fctx.closePath();
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }

						                    case 'horizontalSpectrogram': {
                        if (!this.horizSpectrogramCanvas) {
                            this.horizSpectrogramCanvas = document.createElement('canvas');
                            this.horizSpectrogramCanvas.width = 600;
                            this.horizSpectrogramCanvas.height = 400;
                            this.horizSpectrogramCtx = this.horizSpectrogramCanvas.getContext('2d');
                            this.horizSpectrogramCtx.fillStyle = '#000000';
                            this.horizSpectrogramCtx.fillRect(0, 0, 600, 400);
                        }

                        const hCvs = this.horizSpectrogramCanvas;
                        const hCtx = this.horizSpectrogramCtx;
                        const speed = 3;

                        hCtx.drawImage(hCvs, speed, 0, hCvs.width - speed, hCvs.height, 0, 0, hCvs.width - speed, hCvs.height);

                        hCtx.fillStyle = '#000000';
                        hCtx.fillRect(hCvs.width - speed, 0, speed, hCvs.height);

                        const numBins = hCvs.height;
                        const rgb = themeRgb;

                        const startBin = 3;
                        const maxMappedBin = Math.floor(bufferLength * 0.42);

                        for (let y = 0; y < numBins; y++) {

                            const normY = y / numBins;

                            const logScale = Math.pow(normY, 1.35);
                            const dataIdx = startBin + Math.floor(logScale * (maxMappedBin - startBin));

                            const amp = (dataArray[dataIdx] || 0) / 255;
                            if (amp > 0.01) {

                                if (amp > 0.88) {
                                    hCtx.fillStyle = `rgba(255, 255, 255, ${(amp - 0.8) * 5})`;
                                } else {
                                    hCtx.fillStyle = `rgba(${rgb}, ${amp})`;
                                }
                                hCtx.fillRect(hCvs.width - speed, y, speed, 1);
                            }
                        }

                        fctx.fillStyle = '#000000';
                        fctx.fillRect(0, 0, w, h);
                        fctx.drawImage(hCvs, 0, 0, hCvs.width, hCvs.height, 0, 0, w, h);
                        break;
                    }

                        case 'fullScreenWaterfall': {
                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            if (!this.fullWaterfallHistory) {
                                this.fullWaterfallHistory = [];
                                for (let i = 0; i < 40; i++) {
                                    this.fullWaterfallHistory.push(new Float32Array(80).fill(0));
                                }
                            }

                            const recycledArray = this.fullWaterfallHistory.pop();
                            for (let i = 0; i < 80; i++) {
                                recycledArray[i] = (dataArray[Math.floor(i * (bufferLength / 80))] / 255);
                            }
                            this.fullWaterfallHistory.unshift(recycledArray);

                            const rows = this.fullWaterfallHistory.length;
                            const cols = 80;

                            fctx.save();
                            fctx.lineWidth = 1.5;

                            for (let r = rows - 1; r >= 0; r--) {
                                const z = r / (rows - 1);

                                const rowY = 15 + ((1 - z) * (h - 30));
                                const stepX = w / (cols - 1);

                                const frame = this.fullWaterfallHistory[r];
                                const opacity = 0.2 + z * 0.8;
                                const colorRgb = themeRgb;

                                fctx.strokeStyle = `rgba(${colorRgb}, ${opacity})`;
                                fctx.fillStyle = '#000000';

                                fctx.beginPath();
                                fctx.moveTo(0, h);
                                for (let c = 0; c < cols; c++) {
                                    const amp = frame[c];
                                    const px = c * stepX;
                                    const py = rowY - (amp * (h / 7));
                                    fctx.lineTo(px, py);
                                }
                                fctx.lineTo(w, h);
                                fctx.closePath();
                                fctx.fill();

                                fctx.beginPath();
                                for (let c = 0; c < cols; c++) {
                                    const amp = frame[c];
                                    const px = c * stepX;
                                    const py = rowY - (amp * (h / 7));
                                    if (c === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }

                        case 'audioMesh': {

                            fctx.fillStyle = '#000000';
                            fctx.fillRect(0, 0, w, h);

                            fctx.save();
                            const rgb = themeRgb;
                            fctx.strokeStyle = `rgba(${rgb}, ${0.15 + midrange * 0.35})`;
                            fctx.lineWidth = 1.2;

                            const meshRows = 12;
                            const meshCols = 18;
                            const stepX = w / (meshCols - 1);
                            const stepY = h / (meshRows - 1);

                            for (let r = 0; r < meshRows; r++) {
                                fctx.beginPath();
                                const rowRatio = r / (meshRows - 1);

                                const baseDepthY = rowRatio * h;

                                for (let c = 0; c < meshCols; c++) {
                                    const bin = Math.floor((c / meshCols) * (bufferLength * 0.42));
                                    const amp = (dataArray[bin] || 0) / 255;

                                    const elevation = amp * 75 * Math.sin(rowRatio * Math.PI) * (1.0 + subBass);
                                    const px = c * stepX;
                                    const py = baseDepthY - elevation;

                                    if (c === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }

                            for (let c = 0; c < meshCols; c++) {
                                fctx.beginPath();
                                for (let r = 0; r < meshRows; r++) {
                                    const rowRatio = r / (meshRows - 1);
                                    const baseDepthY = rowRatio * h;
                                    const bin = Math.floor((c / meshCols) * (bufferLength * 0.42));
                                    const amp = (dataArray[bin] || 0) / 255;

                                    const elevation = amp * 75 * Math.sin(rowRatio * Math.PI) * (1.0 + subBass);
                                    const px = c * stepX;
                                    const py = baseDepthY - elevation;

                                    if (r === 0) fctx.moveTo(px, py);
                                    else fctx.lineTo(px, py);
                                }
                                fctx.stroke();
                            }
                            fctx.restore();
                            break;
                        }
                    }

                    if (window.mushroomSporesActive) {
                        if (!this.sporeParticles || this.sporeParticles.length === 0) {
                            this.sporeParticles = [];
                            for (let i = 0; i < 40; i++) {
                                this.sporeParticles.push({
                                    x: Math.random() * w,
                                    y: h + Math.random() * 100,
                                    size: Math.random() * 3 + 1,
                                    speedY: Math.random() * -0.8 - 0.3,
                                    wobble: Math.random() * Math.PI
                                });
                            }
                        }

                        fctx.save();
                        this.sporeParticles.forEach(spore => {
                            spore.y += spore.speedY;
                            spore.wobble += 0.02;

                            const dx = spore.x + Math.sin(spore.wobble) * 15;

                            if (spore.y < -10) {
                                spore.y = h + 10;
                                spore.x = Math.random() * w;
                            }

                            const themeColor = themeAccent || "#3b82f6";
                            fctx.fillStyle = themeColor;
                            fctx.shadowBlur = 6;
                            fctx.shadowColor = themeColor;

                            fctx.globalAlpha = 0.25 + (treble * 0.5);
                            fctx.beginPath();
                            fctx.arc(dx, spore.y, spore.size, 0, Math.PI * 2);
                            fctx.fill();
                        });
                        fctx.restore();
                    }
                }
            };
            drawViz();
        },

        _dspBuildPromise: null,
        ensureDSPGraph: async function() {
            if (this.graphBuilt) return;
            // Re-entrancy guard. Callers fire this concurrently (document click
            // handler, playback hook, drag flush, queued DSP tags). Each awaited
            // addModule independently and built a SECOND worklet graph; the media
            // source stayed wired to the first node while SharedAudio.workletNode
            // pointed at the orphan, so every updateFilters message reached a
            // filter bank that was never in the signal path — dragging EQ nodes
            // changed nothing audibly.
            if (!this._dspBuildPromise) {
                this._dspBuildPromise = this._buildDSPGraph().catch((err) => {
                    console.error("[AudioEngine] DSP graph build failed:", err);
                });
            }
            await this._dspBuildPromise;
            this._dspBuildPromise = null;
        },

        _buildDSPGraph: async function() {
            const ctx = SharedAudio.init();
            // Do NOT await ctx.resume() here. In browsers, an AudioContext created
            // before any user gesture stays 'suspended' and resume()'s promise
            // remains PENDING (never resolves or rejects) until playback is
            // allowed. Boot-time callers (queued DSP tags, visualizer setup) hit
            // this before any click, wedging _dspBuildPromise on a forever-pending
            // promise — after which every later ensureDSPGraph() caller (including
            // togglePlayState for bundled tracks) queued behind it forever. That is
            // why imported files (which bypass ensureDSPGraph) played while the
            // built-in playlist stayed silent in browser testing. Fire-and-forget
            // instead: each playback path resumes the context inside its own user
            // gesture (togglePlayState, onplay handler).
            ctx.resume().catch(() => {});

            try {
                await ctx.audioWorklet.addModule('app/js/dsp-processor.js');
                console.log("[AudioEngine] AudioWorklet dsp-processor module loaded successfully.");
            } catch (err) {
                console.error("[AudioEngine] Failed to load AudioWorklet module. Falling back to native structures.", err);
                showDebugError("AudioWorklet failed to load. Check console/network paths.", "dsp-processor.js");
                return;
            }

            SharedAudio.workletNode = new AudioWorkletNode(ctx, 'dsp-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });

            SharedAudio.workletNode.port.postMessage({
                type: 'init',
                sampleRate: ctx.sampleRate
            });

            this.inputGainNode = ctx.createGain();
            this.inputGainNode.gain.value = 1.0;

            this.musicVolumeNode = ctx.createGain();
            const volSlider = document.getElementById("eq-musicVolumeSlider");
            const initialVol = volSlider ? (parseFloat(volSlider.value) / 100) : 0.5;
            this.musicVolumeNode.gain.value = initialVol;

            this.inputGainNode.connect(SharedAudio.workletNode);

            SharedAudio.workletNode.connect(SharedAudio.compressorFilter);
            SharedAudio.compressorFilter.connect(SharedAudio.compressor);
            SharedAudio.compressor.connect(SharedAudio.compressorGain);
            SharedAudio.compressorGain.connect(SharedAudio.autoGainNode);
            SharedAudio.autoGainNode.connect(SharedAudio.limiter);

            SharedAudio.limiter.connect(SharedAudio.dryGainNode);
            SharedAudio.limiter.connect(SharedAudio.reverbNode);
            SharedAudio.reverbNode.connect(SharedAudio.reverbFilterNode).connect(SharedAudio.wetGainNode);

            SharedAudio.dryGainNode.connect(SharedAudio.crossfeedSplitter);
            SharedAudio.wetGainNode.connect(SharedAudio.crossfeedSplitter);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.directGainL, 0);
            SharedAudio.crossfeedSplitter.connect(SharedAudio.crossfeedFilterL, 0);
            SharedAudio.crossfeedFilterL.connect(SharedAudio.crossfeedDelayL).connect(SharedAudio.crossGainL);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.directGainR, 1);
            SharedAudio.crossfeedSplitter.connect(SharedAudio.crossfeedFilterR, 1);
            SharedAudio.crossfeedFilterR.connect(SharedAudio.crossfeedDelayR).connect(SharedAudio.crossGainR);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.expandGainL, 0);
            SharedAudio.expandGainL.connect(SharedAudio.sumGainR);

            SharedAudio.crossfeedSplitter.connect(SharedAudio.expandGainR, 1);
            SharedAudio.expandGainR.connect(SharedAudio.sumGainL);

            SharedAudio.directGainL.connect(SharedAudio.sumGainL);
            SharedAudio.crossGainR.connect(SharedAudio.sumGainL);

            SharedAudio.directGainR.connect(SharedAudio.sumGainR);
            SharedAudio.crossGainL.connect(SharedAudio.sumGainR);

            SharedAudio.sumGainL.connect(SharedAudio.crossfeedMerger, 0, 0);
            SharedAudio.sumGainR.connect(SharedAudio.crossfeedMerger, 0, 1);

            SharedAudio.crossfeedMerger.connect(this.musicVolumeNode);
            this.musicVolumeNode.connect(SharedAudio.masterGain);

            // Route the <audio> element through the DSP graph EXACTLY once, now,
            // while playback hasn't begun. Creating the MediaElementSource lazily
            // inside the element's onplay handler was the startup-mute bug: by the
            // time onplay fired, audio was already playing, and re-routing a playing
            // element strands the stream (or throws), so 'connected' never took and
            // the only working volume control became the raw audioEl.volume — which
            // the boot-path fade had already set to 0. Locking it here guarantees the
            // graph owns volume from the very first millisecond of playback.
            if (this.audioEl && !this.source) {
                this.source = ctx.createMediaElementSource(this.audioEl);
                // Primary element routes through the sourceGain arm so
                // per-track loudness matching and crossfade fades have a gain
                // to ride on (eq-playlist.js _retargetActiveArm /
                // _crossfadeToStandby read this arm).
                if (!this.sourceGain) {
                    this.sourceGain = ctx.createGain();
                    this.sourceGain.gain.value = Math.max(0.05, Math.min(4, this._activeLoudnessGain || 1));
                }
                this.source.connect(this.sourceGain);
                this.sourceGain.connect(this.inputGainNode);
                this.audioEl.volume = 1.0;
                this.connected = true;
            }

            // Gapless/crossfade standby arm: the B element (eq-audio-gapless)
            // preloads the next track and is crossfaded in at the seam. Both
            // arms must share this DSP graph or the standby would be either
            // silent or always-on top of the active track. Guarded because
            // createMediaElementSource throws when called twice on one
            // element, and _buildDSPGraph can re-run after a failed attempt.
            if (!this._gaplessWired && this.gaplessEl) {
                try {
                    this.gaplessSource = ctx.createMediaElementSource(this.gaplessEl);
                    if (!this.gaplessGain) this.gaplessGain = ctx.createGain();
                    this.gaplessGain.gain.value = 0;
                    this.gaplessSource.connect(this.gaplessGain);
                    this.gaplessGain.connect(this.inputGainNode);
                    this.gaplessEl.volume = 1.0;
                    this._gaplessWired = true;
                } catch (e) {
                    console.warn("[AudioEngine] Gapless standby wiring failed:", e);
                }
            }

            this.graphBuilt = true;
            // Flush coalesced DSP state that arrived while the graph was building
            if (this._pendingDspQueue && this._pendingDspQueue.length) {
                const q = [...new Set(this._pendingDspQueue)];
                this._pendingDspQueue = [];
                for (const tag of q) {
                    try {
                        if (tag === 'filters') this.updateAudioConnections();
                        else if (tag === 'crossover') this.updateCrossoverDSP();
                        else if (tag === 'loudness') this.updateLoudnessDSP();
                        else if (tag === 'simulation') this.updateSimulation();
                        else if (tag === 'gear') this.applyGearSimDSP();
                        else if (tag === 'hearing') this.applyHearingCalibrationGains();
                        else if (tag === 'tape') this.updateTapeModDSP();
                        else if (tag === 'masterTone') this.updateMasterTone('bass', document.getElementById('eq-masterBass')?.value || 0);
                    } catch(_) {}
                }
            }
            this.updateAudioConnections();

            this.updatePreamp();
            this.bands.forEach((_, i) => this.updateSlider(i, 'main'));
            this.advancedBands.forEach((_, i) => this.updateSlider(i, 'adv'));
            this.updateSimulation();
            if (this.applyGearSimDSP) this.applyGearSimDSP();
            if (this.updateTapeModDSP) this.updateTapeModDSP();
            this.updateLoudnessDSP();
            this.updateCrossoverDSP();

            const ratioSlider = document.getElementById('comp-ratio-slider');
            if (ratioSlider) {
                this.updateCompressorParam('ratio', parseFloat(ratioSlider.value) / 10);
            }

            // With the standby arm live, preload the next track so the first
            // skip after boot is already seamless (no-op when gapless and
            // crossfade are both disabled — _standbyReady() gates it).
            if (this._preloadNextTrack) this._preloadNextTrack();
        },

        _pendingDspQueue: [],
        _queuePendingDsp: function(tag) {
            if (!this._pendingDspQueue.includes(tag)) this._pendingDspQueue.push(tag);
            if (!this.graphBuilt) this.ensureDSPGraph().catch(()=>{});
        },
        updateAudioConnections: function() {
            if (!this.graphBuilt || !SharedAudio.workletNode) {
                this._queuePendingDsp('filters');
                return;
            }

            const payload = [];

            this.bands.forEach((b, i) => {
                const isBypassed = window.bypassedBands.has("m" + i);
                const type = b.type || 'peaking';

                const rawHz = parseFloat(document.getElementById("eq-f" + i)?.value);
                const hz = Number.isFinite(rawHz) ? rawHz : b.hz;

                const rawG = parseFloat(document.getElementById("eq-s" + i)?.value);
                const g = isBypassed ? 0.0 : (Number.isFinite(rawG) ? rawG : 0.0);

                const rawQ = parseFloat(document.getElementById("eq-q_m" + i)?.value);
                const q = Number.isFinite(rawQ) ? rawQ : b.defaultQ;

                // Slope (cascade count) only means anything for Shelf/HP/LP
                // sections; a stale value on Peaking/Notch would silently
                // cascade multiple full-gain copies of the same filter.
                // handleTypeChange() resets b.slope on every type change,
                // but this is the actual DSP trust boundary, so it is
                // re-enforced here too (e.g. against a hand-authored preset
                // that round-trips a mismatched type+slope pair).
                const slopeCapable = (type === 'lowshelf' || type === 'highshelf' || type === 'lowpass' || type === 'highpass');
                const activeSlope = slopeCapable ? (b.slope || 12) : 12;
                const cascadeNodesCount = Math.max(1, Math.round(activeSlope / 12));

                for (let k = 0; k < 4; k++) {
                    const idx = (i * 4) + k;
                    let nodeGain = g;
                    let nodeBypassed = (k >= cascadeNodesCount) || isBypassed || !this.eqEnabled;

                    if (type === 'lowshelf' || type === 'highshelf') {
                        nodeGain = g / cascadeNodesCount;
                    }

                    payload.push({
                        index: idx,
                        bypassed: nodeBypassed,
                        filterType: type,
                        frequency: hz,
                        gain: nodeGain,
                        q: q
                    });
                }
            });

            this.advancedBands.forEach((b, i) => {
                const isBypassed = window.bypassedBands.has("a" + i);
                const type = b.type || 'peaking';
                const hz = b.hz;

                const sEl = document.getElementById("eq-a" + i);
                const qEl = document.getElementById("eq-q_a" + i);

                const rawG = sEl ? parseFloat(sEl.value) : undefined;
                const g = isBypassed ? 0.0 : (Number.isFinite(rawG) ? rawG : (b.g !== undefined ? b.g : 0.0));

                const rawQ = qEl ? parseFloat(qEl.value) : undefined;
                const q = Number.isFinite(rawQ) ? rawQ : (b.q !== undefined ? b.q : b.defaultQ);

                payload.push({
                    index: 40 + i,
                    bypassed: isBypassed || !this.eqEnabled,
                    filterType: type,
                    frequency: hz,
                    gain: g,
                    q: q
                });
            });

            if (this.virtualBands) {
                this.virtualBands.forEach((b, i) => {
                    if (i < 30) {
                        const rawG = parseFloat(b.g);
                        const finalG = Number.isFinite(rawG) ? rawG : 0.0;
                        const rawQ = parseFloat(b.q);
                        const finalQ = Number.isFinite(rawQ) ? rawQ : 1.0;

                        payload.push({
                            index: 50 + i,
                            bypassed: !this.eqEnabled,
                            filterType: b.type || 'peaking',
                            frequency: b.hz,
                            gain: finalG,
                            q: finalQ
                        });
                    }
                });
            }

            SharedAudio.workletNode.port.postMessage({
                type: 'updateFilters',
                filters: payload
            });
        },

                toggleEQ: function() {

            var now = Date.now();
            if (this.lastEQToggle && now - this.lastEQToggle < 300) return;
            this.lastEQToggle = now;

            if (window.bypassedBands === undefined) window.bypassedBands = new Set();
            const btn = document.getElementById("eqToggleBtn");
            if (this.eqEnabled) {
                this.eqEnabled = false;
                if (btn) {
                    btn.classList.remove('is-on');
                    btn.textContent = "EQ: OFF";
                }
                showToast("Equalizer Disabled (Bypass)", "🚫");
            } else {
                this.eqEnabled = true;
                if (btn) {
                    btn.classList.add('is-on');
                    btn.textContent = "EQ: ON";
                }
                showToast("Equalizer Enabled (Active)", "✅");
            }

                        this.updateAudioConnections();
            Mascot.update();

            this.bands.forEach((_, i) => {
                const slider = document.getElementById("eq-s" + i);
                if (slider && this.filters[i]) {
                    const isBypassed = window.bypassedBands.has("m" + i);
                    setAudioParamSmooth(this.filters[i].gain, (this.eqEnabled && !isBypassed) ? parseFloat(slider.value) : 0, 0.01);
                }
            });

            this.advancedBands.forEach((b, i) => {
                if (this.advFilters && this.advFilters[i]) {
                    const isBypassed = window.bypassedBands.has("a" + i);
                    const targetGain = (this.eqEnabled && !isBypassed) ? (b.g || 0) : 0;
                    setAudioParamSmooth(this.advFilters[i].gain, targetGain, 0.01);
                }
            });

            if (this.virtualFilters && this.virtualBands) {
                this.virtualFilters.forEach((f, i) => {
                    const b = this.virtualBands[i];
                    const targetGain = (this.eqEnabled && b) ? (b.g || 0) : 0;
                    setAudioParamSmooth(f.gain, targetGain, 0.01);
                });
            }

            this.drawCurve();
        },

switchCategory: function(catId) {
            try {
                this.activePresetCategory = catId;

                const stepperLabel = document.getElementById('preset-category-stepper-label');
                if (stepperLabel && this.presetCategories) {
                    const info = this.presetCategories.find(m => m.id === catId) || this.presetCategories[0];
                    stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
                }

                const categoryContainers = document.querySelectorAll('#rc-panel-presets button');
                categoryContainers.forEach(pill => {
                    if (pill && (pill.id.startsWith('cat-') || pill.id === 'cat-custom')) {
                        pill.classList.remove('active');
                    }
                });
                const activePill = document.getElementById('cat-' + catId);
                if (activePill) activePill.classList.add('active');

                const grid = document.getElementById('preset-grid-content');
                if (!grid) return;
                grid.innerHTML = '';

                if (catId === 'custom') {
                    this.renderCustomPresets();
                    return;
                }

                const list = this.presetsByCategory[catId] || [];
                list.forEach(p => {
                    const btn = document.createElement('button');
                    btn.id = 'preset-btn-' + p.id;

                    btn.className = 'w-full text-center text-[10px] h-8 px-1 py-1 rounded bg-[var(--bg-card)] border border-[var(--border-color)]/50 text-[var(--text-main)] hover:bg-[var(--bg-input)] transition-all font-semibold shadow-sm truncate flex items-center justify-center gap-1 cursor-pointer';
                    btn.innerHTML = `<span>${p.name}</span>`;
                    btn.onclick = () => { this.applyPreset(p.id); };
                    grid.appendChild(btn);

                    if (p.id === this.activePreset) {
                        btn.classList.remove('bg-[var(--bg-card)]', 'text-[var(--text-main)]');
                        btn.classList.add('bg-[var(--accent-blue)]', 'text-white', 'border-[var(--accent-blue)]');
                    }
                });
            } catch (err) {
                console.warn("Preset generation catch block active:", err);
            }
        },

        lastDrawTime: 0,

        applyGeneratedPEQ: function(bands) {
            EQ_Module.isProgrammaticSliderUpdate = true;

            this.bands.forEach((b, i) => {
                const sSlider = document.getElementById("eq-s" + i);
                const fInput = document.getElementById("eq-f" + i);
                const qSlider = document.getElementById("eq-q_m" + i);

                if (sSlider) sSlider.value = 0;
                if (fInput) fInput.value = b.hz;
                if (qSlider) qSlider.value = b.defaultQ;

                const freqSlider = document.getElementById(`eq-fs_m${i}`);
                if (freqSlider) freqSlider.value = this.logHzToSlider(b.hz);

                const gainNum = document.getElementById(`eq-s${i}_num`);
                if (gainNum) gainNum.value = "0.0";
                const qNum = document.getElementById(`eq-q_m${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                if (this.filters[i]) {
                    this.filters[i].type = b.type;
                    setAudioParamSmooth(this.filters[i].frequency, b.hz);
                    setAudioParamSmooth(this.filters[i].gain, 0);
                    setAudioParamSmooth(this.filters[i].Q, b.defaultQ);
                }
            });

            this.advancedBands.forEach((b, i) => {
                const aSlider = document.getElementById("eq-a" + i);
                const afInput = document.getElementById("eq-af" + i);
                const qSlider = document.getElementById("eq-q_a" + i);
                const typeBtn = document.getElementById(`eq-t_a${i}`);

                if (aSlider) aSlider.value = 0;
                if (afInput) afInput.value = b.hz;
                if (qSlider) qSlider.value = b.defaultQ;
                if (typeBtn) typeBtn.textContent = 'PK';
                b.type = 'peaking';

                const freqSlider = document.getElementById(`eq-fs_a${i}`);
                if (freqSlider) freqSlider.value = this.logHzToSlider(b.hz);

                const gainNum = document.getElementById(`eq-a${i}_num`);
                if (gainNum) gainNum.value = "0.0";
                const qNum = document.getElementById(`eq-q_a${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                const gainRow = document.getElementById(`row-gain_a${i}`);
                if (gainRow) {
                    gainRow.style.opacity = '1';
                    gainRow.style.pointerEvents = 'auto';
                }

                if (this.advFilters[i]) {
                    this.advFilters[i].type = 'peaking';
                    setAudioParamSmooth(this.advFilters[i].frequency, b.hz);
                    setAudioParamSmooth(this.advFilters[i].gain, 0);
                    setAudioParamSmooth(this.advFilters[i].Q, b.defaultQ);
                }
            });

            if (!bands || bands.length === 0) {
                document.getElementById("eq-preampSlider").value = 0;
                if (this.preampNode) setAudioParamSmooth(this.preampNode.gain, 1);
                EQ_Module.isProgrammaticSliderUpdate = false;
                this.drawCurve();
                if (window.syncGlobalSliders) window.syncGlobalSliders();
                return;
            }

            const maxGain = Math.max(...bands.map(b => b.gain));
            const preamp = maxGain > 0 ? -maxGain : 0;
            const preampSlider = document.getElementById("eq-preampSlider");
            if (preampSlider) preampSlider.value = preamp.toFixed(1);
            this.updatePreamp();

            bands.forEach((b, i) => {
                if (i < this.bands.length) {
                    const sSlider = document.getElementById("eq-s" + i);
                    const fInput = document.getElementById("eq-f" + i);
                    const qSlider = document.getElementById("eq-q_m" + i);

                    if (fInput) fInput.value = Math.round(b.freq);
                    if (sSlider) sSlider.value = b.gain.toFixed(1);
                    if (qSlider) qSlider.value = b.q.toFixed(1);

                    const freqSlider = document.getElementById(`eq-fs_m${i}`);
                    if (freqSlider) freqSlider.value = EQ_Module.logHzToSlider(b.freq);

                    const gainNum = document.getElementById(`eq-s${i}_num`);
                    if (gainNum) gainNum.value = b.gain.toFixed(1);
                    const qNum = document.getElementById(`eq-q_m${i}_num`);
                    if (qNum) qNum.value = b.q.toFixed(2);

                    EQ_Module.updateSlider(i, 'main');
                }
            });

            EQ_Module.isProgrammaticSliderUpdate = false;

            if (EQ_Module.graphBuilt) {
                EQ_Module.updateAudioConnections();
            }

            this.drawCurve();

            this.bands.forEach((_, i) => this.updateSlider(i, 'main'));
            this.advancedBands.forEach((_, i) => this.updateSlider(i, 'adv'));

            if (window.syncGlobalSliders) window.syncGlobalSliders();

            // Generated PEQ reshaped the DSP curve programmatically — unlock
            // live Similar-mode matching.
            PEQDB_Module._similarTargetEverModified = true;
        },

        clearAudio: function() { this.audioEl.pause(); this.audioEl.removeAttribute("src"); this.audioEl.load(); document.getElementById("eq-file").value = ""; this.audioEl.volume = 0.5; },
        resetEQ: function(skipDraw) {
            this.activePreset = null;
            EQ_Module.isProgrammaticSliderUpdate = true;
            const _prevSuppress = this._suppressDraw;
            if (skipDraw) this._suppressDraw = true;

            this.bands.forEach((b, i) => {
                const fInput = document.getElementById("eq-f" + i);
                if (fInput) fInput.value = b.hz;
                const fsSlider = document.getElementById(`eq-fs_m${i}`);
                if (fsSlider) fsSlider.value = this.logHzToSlider(b.hz);

                const sSlider = document.getElementById("eq-s" + i);
                if (sSlider) sSlider.value = 0;
                const sNum = document.getElementById(`eq-s${i}_num`);
                if (sNum) sNum.value = "0.0";

                const qSlider = document.getElementById("eq-q_m" + i);
                if (qSlider) qSlider.value = b.defaultQ;
                const qNum = document.getElementById(`eq-q_m${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                if (this.filters[i]) {
                    this.filters[i].type = b.type;
                    setAudioParamSmooth(this.filters[i].frequency, b.hz);
                    setAudioParamSmooth(this.filters[i].gain, 0);
                    setAudioParamSmooth(this.filters[i].Q, b.defaultQ);
                }

                this.updateSlider(i, 'main');
            });

            this.advancedBands.forEach((b, i) => {
                const fInput = document.getElementById("eq-af" + i);
                if (fInput) fInput.value = b.hz;
                const fsSlider = document.getElementById(`eq-fs_a${i}`);
                if (fsSlider) fsSlider.value = this.logHzToSlider(b.hz);

                const aSlider = document.getElementById("eq-a" + i);
                if (aSlider) aSlider.value = 0;
                const aNum = document.getElementById(`eq-a${i}_num`);
                if (aNum) aNum.value = "0.0";

                const qSlider = document.getElementById("eq-q_a" + i);
                if (qSlider) qSlider.value = b.defaultQ;
                const qNum = document.getElementById(`eq-q_a${i}_num`);
                if (qNum) qNum.value = b.defaultQ.toFixed(2);

                const typeBtn = document.getElementById(`eq-t_a${i}`);
                if (typeBtn) typeBtn.textContent = 'PK';
                b.type = 'peaking';
                b.g = 0;

                const gainRow = document.getElementById(`row-gain_a${i}`);
                if (gainRow) {
                    gainRow.style.opacity = '1';
                    gainRow.style.pointerEvents = 'auto';
                }

                if (this.advFilters[i]) {
                    this.advFilters[i].type = 'peaking';
                    setAudioParamSmooth(this.advFilters[i].frequency, b.hz);
                    setAudioParamSmooth(this.advFilters[i].gain, 0);
                    setAudioParamSmooth(this.advFilters[i].Q, b.defaultQ);
                }

                this.updateSlider(i, 'adv');
            });

            this.virtualBands = [];
            if (this.virtualFilters) {
                this.virtualFilters.forEach(f => {
                    setAudioParamSmooth(f.gain, 0);
                });
            }

            const preSlider = document.getElementById("eq-preampSlider");
            if (preSlider) preSlider.value = "0.0";
            const preVal = document.getElementById("eq-preampVal");
            if (preVal) preVal.value = "0.0";
            if (this.preampNode) setAudioParamSmooth(this.preampNode.gain, 1.0);

            this.updatePreamp();

            EQ_Module.isProgrammaticSliderUpdate = false;

            const sliderDefaults = {
                'comp-attack-slider': { val: 15, param: 'attack', text: '15.0 ms' },
                'comp-release-slider': { val: 100, param: 'release', text: '100.0 ms' },
                'comp-ratio-slider': { val: 40, param: 'ratio', text: '4.0 : 1' },
                'comp-frequency-slider': { val: 1000, param: 'frequency', text: '1.0k Hz' },
                'comp-threshold-slider': { val: -150, param: 'threshold', text: '-15.0 dB' },
                'comp-gain-slider': { val: 0, param: 'gain', text: '0.0 dB' }
            };

            Object.entries(sliderDefaults).forEach(([id, config]) => {
                const el = document.getElementById(id);
                if (el) el.value = config.val;

                const disp = document.getElementById(`comp-${config.param}-val`);
                if (disp) disp.textContent = config.text;

                if (SharedAudio.compressor) {
                    const value = config.val;
                    if (config.param === 'attack') setAudioParamSmooth(SharedAudio.compressor.attack, value / 1000, 0.015);
                    else if (config.param === 'release') setAudioParamSmooth(SharedAudio.compressor.release, value / 1000, 0.015);
                    else if (config.param === 'ratio') setAudioParamSmooth(SharedAudio.compressor.ratio, value / 10, 0.015);
                    else if (config.param === 'frequency' && SharedAudio.compressorFilter) setAudioParamSmooth(SharedAudio.compressorFilter.frequency, value, 0.015);
                    else if (config.param === 'threshold') setAudioParamSmooth(SharedAudio.compressor.threshold, value / 10, 0.015);
                    else if (config.param === 'gain' && SharedAudio.compressorGain) setAudioParamSmooth(SharedAudio.compressorGain.gain, Math.pow(10, (value / 10) / 20), 0.015);
                }
            });

            if (this.compressorActive) {
                this.toggleCompressor();
            }

            this._suppressDraw = _prevSuppress;
            if (!skipDraw) this.drawCurve();
            if (window.syncGlobalSliders) window.syncGlobalSliders();
        },

    };
