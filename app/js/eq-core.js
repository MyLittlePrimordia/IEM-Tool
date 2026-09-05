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

            // (presetCategories extracted to eq-presets-data.js — EQ_PresetsData)
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

            // (tape-mod methods extracted to eq-tape-mod.js — EQ_TapeModMethods,
            // merged via Object.assign in db-cache.js)

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
        // (vizModeIndex/vizModes + startVisualizer extracted to eq-visualizer.js
        //  — EQ_VisualizerMethods, merged via Object.assign in db-cache.js)
            fullscreenVizCanvas: null,
            fullscreenVizCtx: null,

            // (presetsByCategory extracted to eq-presets-data.js — EQ_PresetsData)

        eqPresets: null,

        // NOTE: the legacy native-BiquadFilterNode arrays (filters, advFilters,
        // virtualFilters, mathFilters + offlineCtx) are GONE — all filtering runs
        // in the AudioWorklet (dsp-processor.js) and all curve math evaluates
        // through getBiquadMagnitude. The worklet's filter bank is the single
        // source of truth for both audio and drawing.
        audioEl: null, source: null, preampNode: null, eqEnabled: true, preventClipping: false, connected: false, graphBuilt: false,
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
            this.eqPresets = JSON.parse(EQ_PresetsData.eqPresetsJson);

            // (curatedPresets extracted to eq-presets-data.js — EQ_PresetsData.curatedPresets)
            Object.assign(this.eqPresets, EQ_PresetsData.curatedPresets);

            this.initDOMCache();
            this.allocateResponseBuffers(150);
            this.injectDynamicPresetsOnLoad();
            this.attachMediaTransport();

            // The graph used to keep 70 OfflineAudioContext biquads ("mathFilters")
            // alive purely for getFrequencyResponse curve drawing. The curve now
            // evaluates through getBiquadMagnitude (the worklet's exact RBJ math),
            // so neither the offline context nor the filter bank exists anymore.

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

            this.attachGraphInput();
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
                this._uacCoalesced();
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
                    this._uacCoalesced();
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
                if (qSlider) setSliderFill(qSlider, b.q !== undefined ? b.q : 0.1, 10);

                this.recalculateAutoGainMatch();
                this.updatePreamp();

                if (this.graphBuilt && !EQ_Module.isProgrammaticSliderUpdate) {
                    this._uacCoalesced();
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
        // (genre-target picker cluster extracted to eq-genre-targets.js —

        // (getBiquadMagnitude extracted to eq-biquad-math.js — EQ_BiquadMathMethods,
        // merged via Object.assign in db-cache.js)

        // hzToX/xToHz/dbToY/yToDb/getFilterAtCoords were removed here: they
        // referenced a canvas ID (#eq-largeResponseViz) that doesn't exist
        // anywhere in index.html, had zero callers outside this cluster,
        // and used hardcoded 980x320 canvas dimensions that don't match
        // the real EQ graph canvas (#eq-squiglinkViz, which is DPR-scaled
        // and dynamically sized). The live hit-testing path is the
        // closure-scoped getEQNodeAtCoords used by the graph's own
        // mouse/touch handlers -- this was an orphaned duplicate, not a
        // second code path anything depended on.

        //  match badges + calculateTargetMatches — EQ_GenreTargetMethods, merged via Object.assign in db-cache.js)

        // (startVisualizer + viz mode state extracted to eq-visualizer.js —
        //  EQ_VisualizerMethods, merged via Object.assign in db-cache.js)

        // (DSP graph lifecycle + worklet bridge + safety limiter + toggleEQ
        //  extracted to eq-dsp-graph.js — EQ_DspGraphMethods, merged via Object.assign in db-cache.js)

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

                this.updateSlider(i, 'adv');
            });

            this.virtualBands = [];
            // (native virtualFilters zeroing removed — the worklet's virtual
            // bank is cleared by the next updateAudioConnections push)

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
