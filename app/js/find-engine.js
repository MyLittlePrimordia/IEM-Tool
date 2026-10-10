// Split out of the former monolithic app-core.js (2026 refactor).
// FindEngine (spec-based matching/filtering) plus the small AppState object
// and boot-sequence tail that used to close out app-core.js.
            const FindEngine = {
                canonicalCache: {},
                isScanning: false,
                currentBaselineIndex: 0,
                isClonedModeActive: false,
                clonedTargetInterp: null,
                findMode: 'tuning',
                iemDatabase: [],
                filterTags: new Set(),
                selectedPicks: [],
                approvedTagsList: [
                    "Basshead", "Sub-Bass", "Punchy Bass", "Warm", "Neutral", "V-Shaped", "Balanced",
                    "Bright", "Dark", "Detailed", "Resolving", "Technical", "Wide-Stage", "Good-Imaging",
                    "Smooth", "Reference", "Analytical", "Fun", "Relaxed", "Gaming", "Competitive-Gaming",
                    "Vocal-Focused", "Budget", "Mid-Tier", "Premium", "Flagship", "Collab", "Limited-Edition"
                ],
                tagEmojis: {
                    "Basshead": "💥", "Sub-Bass": "🌊", "Punchy Bass": "🥊", "Warm": "🌿", "Neutral": "⚖️", "V-Shaped": "🔺", "Balanced": "☯️",
                    "Bright": "✨", "Dark": "🌑", "Detailed": "💎", "Resolving": "🔍", "Technical": "🔬", "Wide-Stage": "🏟️", "Good-Imaging": "🔭",
                    "Smooth": "🧈", "Reference": "📐", "Analytical": "🧠", "Fun": "🔥", "Relaxed": "😌", "Gaming": "🎮", "Competitive-Gaming": "🏆",
                    "Vocal-Focused": "🗣️", "Budget": "💰", "Mid-Tier": "🪙", "Premium": "👑", "Flagship": "🥇", "Collab": "🤝", "Limited-Edition": "🌟",
                    "Vintage": "📼"
                },

                _toggleCustomMenuPrefixed: function(prefix, keys, key) {
                    keys.forEach(k => {
                        const menu = document.getElementById(`menu-${prefix}-filter-${k}`);
                        if (menu) {
                            if (k === key) menu.classList.toggle('hidden');
                            else menu.classList.add('hidden');
                        }
                    });
                },
                toggleCustomMenu: function(key) {
                    this._toggleCustomMenuPrefixed('find', ['driver', 'connector', 'tag', 'formfactor'], key);
                },

                driverOptions: [
                    { val: 'any', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any Type' },
                    { val: 'DD', label: '<img src="app/icons/dd.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Dynamic (DD)' },
                    { val: 'BA', label: '<img src="app/icons/ba.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Balanced Armature (BA)' },
                    { val: 'Planar', label: '<img src="app/icons/planar.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Planar' },
                    { val: 'Hybrid', label: '<img src="app/icons/hybrid.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Hybrid' },
                    { val: 'Tribrid', label: '<img src="app/icons/trybrid.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Tribrid' },
                    { val: 'EST', label: '<img src="app/icons/est.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Electrostatic (EST)' },
                    { val: 'PZT', label: '<img src="app/icons/pzt.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Piezoelectric (PZT)' },
                    { val: 'BC', label: '<img src="app/icons/bc.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Bone Conduction (BC)' },
                    { val: 'MEMS', label: '<img src="app/icons/mems.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> MEMS' }
                ],

                connectorOptions: [
                    { val: 'any', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any Connector' },
                    { val: '2-pin', label: '<img src="app/icons/2pin.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> 2-pin' },
                    { val: 'MMCX', label: '<img src="app/icons/mmcx.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> MMCX' },
                    { val: 'QDC', label: '<img src="app/icons/qdc.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> QDC' },
                    { val: 'A2DC', label: '<img src="app/icons/a2dc.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> A2DC' },
                    { val: 'Bluetooth', label: '<img src="app/icons/bluetooth.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Bluetooth' },
                    { val: 'Detachable Cable', label: '<img src="app/icons/detach.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Detachable Cable' },
                    { val: 'Fixed Cable', label: '<img src="app/icons/fixed.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Fixed Cable' },
                    { val: 'Electrostatic', label: '<img src="app/icons/electro.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Electrostatic' },
                    { val: 'Unknown', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">❓</span> Unknown' }
                ],

                formFactorOptions: [
                    { val: 'any', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any Form Factor' },
                    { val: 'IEM', label: '<img src="app/icons/iem.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> In-Ear Monitor (IEM)' },
                    { val: 'Earbuds (Wired)', label: '<img src="app/icons/earbud.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Earbuds (Wired)' },
                    { val: 'Wireless Earbuds (TWS)', label: '<img src="app/icons/tws.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Wireless Earbuds (TWS)' },
                    { val: 'Over-Ear Headphones (Wired)', label: '<img src="app/icons/headphone.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Over-Ear Headphones' },
                    { val: 'Wireless Over-Ear Headphones', label: '<img src="app/icons/wireless.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Wireless Over-Ear' }
                ],

                ugFormFactorOptions: [
                    { val: 'any', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any Form Factor' },
                    { val: 'auto', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎯</span> Match Base IEM' },
                    { val: 'IEM', label: '<img src="app/icons/iem.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> In-Ear Monitor (IEM)' },
                    { val: 'Earbuds (Wired)', label: '<img src="app/icons/earbud.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Earbuds (Wired)' },
                    { val: 'Wireless Earbuds (TWS)', label: '<img src="app/icons/tws.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Wireless Earbuds (TWS)' },
                    { val: 'Over-Ear Headphones (Wired)', label: '<img src="app/icons/headphone.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Over-Ear Headphones' },
                    { val: 'Wireless Over-Ear Headphones', label: '<img src="app/icons/wireless.png" class="w-6 h-6 object-contain flex-shrink-0 inline-block mr-1.5 anim-toggle-pop"> Wireless Over-Ear' }
                ],





                _pickGroupList: function() {
                    const tags = this.approvedTagsList || [];
                    const tagOf = (name) => ({ kind: 'meta', value: name, emoji: this.tagEmojis[name] || '🏷️' });
                    const soundTuning = ['Basshead', 'Sub-Bass', 'Punchy Bass', 'Warm', 'Neutral', 'V-Shaped', 'Balanced', 'Bright', 'Dark', 'Detailed', 'Resolving', 'Technical', 'Wide-Stage', 'Good-Imaging', 'Smooth', 'Reference', 'Analytical', 'Fun', 'Relaxed', 'Vocal-Focused'];
                    const special = ['Budget', 'Mid-Tier', 'Premium', 'Flagship', 'Collab', 'Limited-Edition'];
                    const gamingAttrs = ['Gaming', 'Competitive-Gaming'];
                    const known = new Set([...soundTuning, ...special, ...gamingAttrs]);
                    const leftover = tags.filter(t => !known.has(t));
                    const musicItems = (this.genreFamilies || []).map(f => { const v = f.musicVariants[0]; return v ? { kind: 'music', value: v.name, emoji: v.emoji } : null; }).filter(Boolean);
                    const gameItems = (this.genreFamilies || []).map(f => { const v = f.gameVariants[0]; return v ? { kind: 'game', value: v.name, emoji: v.emoji } : null; }).filter(Boolean);
                    const groups = [
                        { title: 'Tuning Tags', emoji: '🎛️', cls: 'text-sky-400', kind: 'meta', items: soundTuning.filter(t => tags.includes(t)).map(tagOf) },
                        { title: 'Music Tags', emoji: '🎵', cls: 'text-cyan-400', kind: 'music', items: musicItems },
                        { title: 'Gaming Tags', emoji: '🎮', cls: 'text-amber-500', kind: 'game', items: [...gameItems, ...gamingAttrs.filter(t => tags.includes(t)).map(tagOf)] },
                        { title: 'Other Tags', emoji: '✨', cls: 'text-violet-400', kind: 'meta', items: [...special.filter(t => tags.includes(t)).map(tagOf), ...leftover.map(tagOf)] }
                    ];
                    return groups;
                },

                _pickEmojiFor: function(kind, value) {
                    let emoji = '🏷️';
                    this._pickGroupList().forEach(g => g.items.forEach(p => { if (p.kind === kind && p.value === value) emoji = p.emoji; }));
                    return emoji;
                },

                pickFx: {
                    'Basshead': 'basshead', 'Sub-Bass': 'subbass', 'Punchy Bass': 'punch', 'Warm': 'warm',
                    'Neutral': 'neutral', 'V-Shaped': 'vshape', 'Balanced': 'balanced', 'Bright': 'bright',
                    'Dark': 'dark', 'Detailed': 'detailed', 'Resolving': 'resolving', 'Technical': 'technical',
                    'Wide-Stage': 'widestage', 'Good-Imaging': 'imaging', 'Smooth': 'smooth', 'Reference': 'reference',
                    'Analytical': 'analytical', 'Fun': 'fun', 'Relaxed': 'relaxed', 'Vocal-Focused': 'vocal',
                    'Hip-Hop': 'hiphop', 'EDM': 'edm', 'Reggae': 'reggae', 'Pop': 'pop', 'Disco': 'disco',
                    'Techno': 'techno', 'Synthwave': 'synthwave', 'Rock': 'rock', 'Jazz': 'jazz', 'World': 'world',
                    'Classical': 'classical', 'Folk': 'folk', 'Indie': 'indie', 'Lo-Fi': 'lofi', 'ASMR': 'asmr',
                    'Cinematic': 'cinematic', 'Zombie': 'zombie', 'Racing': 'racing', 'Adventure': 'adventure',
                    'RPG': 'rpg', 'Roguelike': 'roguelike', 'Sci-Fi': 'scifi', 'Tactical': 'tactical',
                    'Action': 'action', 'MMO': 'mmo', 'Sports': 'sports', 'Strategy': 'strategy', 'Cozy': 'cozy',
                    'Horror': 'horror', 'Puzzle': 'puzzle', 'Arcade': 'arcade', 'FPS': 'fps',
                    'Gaming': 'gaming', 'Competitive-Gaming': 'compgaming',
                    'Budget': 'budget', 'Mid-Tier': 'midtier', 'Premium': 'premium', 'Flagship': 'flagship',
                    'Collab': 'collab', 'Limited-Edition': 'limited', 'Vintage': 'vintage'
                },

                renderPickGrid: function() {
                    const grid = document.getElementById('find-pick-grid');
                    if (!grid) return;
                    const selected = this.selectedPicks || [];
                    const isSel = p => selected.some(s => s.kind === p.kind && s.value === p.value);
                    let html = '';
                    this._pickGroupList().forEach(group => {
                        if (!group.items.length) return;
                        html += `<div class="pick-group">
                            <span class="pick-group-label ${group.cls || 'text-zinc-400'}">${group.emoji} ${group.title}</span>
                            <div class="pick-group-grid">`;
                        group.items.forEach(p => {
                            const on = isSel(p);
                            const fx = this.pickFx[p.value] || '';
                            const playing = on && p.value === this._lastFx ? ' fx-play' : '';
                            html += `<button type="button" data-cmd="FindEngine.togglePick" data-arg-0="${esc(p.kind)}" data-arg-1="${esc(p.value)}" data-tooltip="${p.value}" data-value="${p.value}" data-fx="${fx}" class="no-tactile find-pick-badge ${on ? 'on' : ''}${playing}" aria-pressed="${on}">
                                <span class="emoji-font vibrant-emoji leading-none pointer-events-none">${p.emoji}</span>
                            </button>`;
                        });
                        html += `</div></div>`;
                    });
                    grid.innerHTML = html;
                    this._lastFx = null;
                    this.fitPickGrid();
                },

                fitPickGrid: function() {
                    // Must match --pick-emoji in app.css (#find-pick-grid);
                    // FX decorations scale off this variable.
                    const grid = document.getElementById('find-pick-grid');
                    if (grid) grid.style.setProperty('--pick-emoji', '19px');
                },

                togglePick: function(kind, value) {
                    const picks = this.selectedPicks || [];
                    const idx = picks.findIndex(p => p.kind === kind && p.value === value);
                    if (idx === -1) {
                        picks.push({ kind, value, emoji: this._pickEmojiFor(kind, value) });
                        this._lastFx = value;
                    } else {
                        picks.splice(idx, 1);
                        this._lastFx = null;
                    }
                    this.selectedPicks = picks;
                    this.updatePickUI();
                },



                updatePickUI: function() {
                    const hidden = document.getElementById('find-filter-picks');
                    if (hidden) hidden.value = JSON.stringify(this.selectedPicks || []);
                    const count = document.getElementById('find-pick-count');
                    const picks = this.selectedPicks || [];
                    if (count) {
                        count.textContent = String(picks.length);
                        count.classList.toggle('hidden', picks.length === 0);
                    }
                    this.renderPickGrid();
                },

                countPickMatches: function(item, dbEntry, picks) {
                    picks = picks || this.selectedPicks || [];
                    if (!picks.length) return 0;
                    let count = 0;
                    let music = null, game = null;
                    for (const p of picks) {
                        if (p.kind === 'meta') {
                            if (dbEntry && dbEntry.tags && Array.isArray(dbEntry.tags)) {
                                const reqLower = String(p.value).toLowerCase();
                                const hasTag = dbEntry.tags.some(t => { const tl = String(t).toLowerCase(); return tl.includes(reqLower) || reqLower.includes(tl); });
                                if (hasTag) count++;
                            }
                        } else if (p.kind === 'music') {
                            if (!music) music = this.determineIemGenreMatch(item, dbEntry);
                            if (music && music.name === p.value) count++;
                        } else if (p.kind === 'game') {
                            if (!game) game = this.determineIemGameGenreMatch(item, dbEntry);
                            if (game && game.name === p.value) count++;
                        }
                    }
                    return count;
                },
                driverEmojis: {
                    "DD": '<img src="app/icons/dd.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "BA": '<img src="app/icons/ba.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Planar": '<img src="app/icons/planar.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "EST": '<img src="app/icons/est.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "PZT": '<img src="app/icons/pzt.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "BC": '<img src="app/icons/bc.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "MEMS": '<img src="app/icons/mems.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Hybrid": '<img src="app/icons/hybrid.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Tribrid": '<img src="app/icons/trybrid.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">'
                },
                connectorEmojis: {
                    "Bluetooth": '<img src="app/icons/bluetooth.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "2-pin": '<img src="app/icons/2pin.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "QDC": '<img src="app/icons/qdc.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "MMCX": '<img src="app/icons/mmcx.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "A2DC": '<img src="app/icons/a2dc.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Fixed Cable": '<img src="app/icons/fixed.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Detachable Cable": '<img src="app/icons/detach.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Electrostatic": '<img src="app/icons/electro.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    "Unknown": "❓"
                },
                formFactorEmojis: {
                    'IEM': '<img src="app/icons/iem.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    'Earbuds (Wired)': '<img src="app/icons/earbud.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    'Wireless Earbuds (TWS)': '<img src="app/icons/tws.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    'Over-Ear Headphones (Wired)': '<img src="app/icons/headphone.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">',
                    'Wireless Over-Ear Headphones': '<img src="app/icons/wireless.png" style="width:20px; height:20px; display:inline-block; vertical-align:middle; margin-right:2px;" class="object-contain">'
                },
                getTagEmoji: function(tagStr) {
                    // Tags come straight out of database.json, where only the
                    // ARRAY-ness is validated (peqdb-module.js buildDataset) —
                    // never the element type. A numeric tag is truthy, so this
                    // reached (5).toLowerCase() and threw. That throw happened
                    // inside renderChunk's setTimeout with no try/catch, so the
                    // chunk chain died mid-render, the IntersectionObserver was
                    // never attached, finalizeRender() never ran, and the user
                    // got a silently truncated results grid with no error.
                    if (tagStr === null || tagStr === undefined || tagStr === '') return '🏷️';
                    if (typeof tagStr !== 'string') tagStr = String(tagStr);
                    const emojiMatch = tagStr.match(/^(\p{Extended_Pictographic}|\p{Emoji})/u);
                    if (emojiMatch) return '';
                    const cleanKey = tagStr.toLowerCase().trim().replace(/_/g, '-');
                    const emojiMap = {
                        'basshead': '💥', 'sub-bass': '🌊', 'sub bass': '🌊', 'punchy-bass': '🥊', 'punchy bass': '🥊',
                        'warm': '🌿', 'warm-tilt': '🌿', 'neutral': '⚖️', 'v-shaped': '🔺', 'v-shape': '🔺',
                        'balanced': '☯️', 'bright': '✨', 'dark': '🌑', 'detailed': '💎', 'detail': '💎',
                        'resolving': '🔍', 'technical': '🔬', 'wide-stage': '🏟️', 'soundstage': '🏟️',
                        'good-imaging': '🔭', 'imaging': '🔭', 'smooth': '🧈', 'reference': '📐',
                        'analytical': '🧠', 'fun': '🔥', 'relaxed': '😌', 'gaming': '🎮',
                        'competitive-gaming': '🏆', 'vocal-focused': '🗣️', 'vocal': '🎤', 'budget': '💰',
                        'mid-tier': '🪙', 'premium': '👑', 'flagship': '🥇', 'collab': '🤝',
                        'limited-edition': '🌟', 'vintage': '📼'
                    };
                    return emojiMap[cleanKey] || '🏷️';
                },
                baselineOptions: [
                    { id: 'harman', label: 'Harman IE 2019', emoji: '🎯' },
                    { id: 'moondrop_vdsf', label: 'Moondrop VDSF', emoji: '🌙' },
                    { id: 'peqdb_diamond', label: 'PEQdb Diamond', emoji: '💎' },
                    { id: 'jm-1', label: 'JM-1', emoji: '🔬' },
                    { id: 'diffuse_field', label: 'Diffuse Field', emoji: '📐' },
                    { id: 'basshead', label: 'Basshead', emoji: '💥' },
                    { id: 'vshape', label: 'V-Shape', emoji: '🔺' },
                    { id: 'gaming', label: 'Gaming', emoji: '🎮' },
                    { id: 'flat', label: 'Flat Neutral', emoji: '📏' }
                ],

                init: async function() {
                    this.bindEvents();
                    this.loadCachedCanonicalProfiles();
                    this.checkInitialProgress();

                    await this.loadDatabase();

                    this.currentBaselineIndex = 0;
                    const btn = document.getElementById('find-baseline-btn');
                    if (btn) {
                        const opt = this.baselineOptions[0];
                        btn.textContent = `${opt.emoji} Baseline: ${opt.label}`;
                    }

                    this.loadSavedTasteFavorites();
                    this.renderPickGrid();
                    this.renderSpecChipGrids();
                    window.addEventListener('resize', () => this.fitPickGrid());

                    setTimeout(() => {
                        this.drawTargetVisualization();
                        const radarCard = document.getElementById('find-radar-card');
                        if (radarCard) radarCard.classList.remove('hidden');
                        this.drawTasteRadar();
                    }, 200);

                    this.startActiveSlotObserver();
                },



                _freqWeight: function(f) {
                    // Single source of truth: CurveUtils.freqWeight
                    // (js/utils.js), shared verbatim with find-worker.js.
                    return CurveUtils.freqWeight(f);
                },

                _scoreInterp: function(interp, targetInterp, freqs, weighted = true) {
                    // Single source of truth: CurveUtils.scoreInterp.
                    return CurveUtils.scoreInterp(interp, targetInterp, freqs, weighted);
                },

                calculateCurveMatchScore: function(candidateData, targetInterp, freqs, weighted = true) {
                    if (!candidateData || candidateData.length < 2) return null;
                    const norm = CurveUtils.normalizeTo75dB(candidateData, 500, 75);
                    const interp = CurveUtils.cubicSplineInterpolate(norm, freqs);
                    return this._scoreInterp(interp, targetInterp, freqs, weighted);
                },


                driverTechCanon: { DD: 'DD', DYNAMIC: 'DD', BA: 'BA', ARMATURE: 'BA', PLANAR: 'Planar', EST: 'EST', ELECTROSTATIC: 'EST', PZT: 'PZT', PIEZO: 'PZT', PIEZOELECTRIC: 'PZT', BC: 'BC', BONE: 'BC', MEMS: 'MEMS' },
                parseDriverConfig: function(configStr) {
                    if (!configStr) return [];
                    const found = [];
                    // Split on &, "and", "with" as well as + , / — "DD & BA"
                    // previously tokenized as one chunk and matched DD only.
                    // Non-capturing groups only: a capturing group would make
                    // split() inject the captured separators (or undefined)
                    // into the token list and crash .trim() below.
                    String(configStr).split(/[+]|[,/;|]|&(?:amp;)?|\b(?:and|with|plus)\b/gi).forEach(token => {
                        if (!token) return;
                        const m = token.trim().match(/^[\d.]*\s*x?\s*([A-Za-z]+)/i);
                        if (!m) return;
                        const canonical = this.driverTechCanon[m[1].toUpperCase()];
                        if (canonical && !found.includes(canonical)) found.push(canonical);
                    }, this);
                    return found;
                },

                driverFilterMatches: function(db, filterDriverVal) {
                    if (!db || filterDriverVal === 'any' || !filterDriverVal) return true;
                    if (filterDriverVal === 'Hybrid' || filterDriverVal === 'Tribrid') {
                        return db.driver_type === filterDriverVal;
                    }
                    const techs = this.parseDriverConfig(db.driver_config);
                    if (techs.length > 0) return techs.includes(filterDriverVal);

                    return db.driver_type === filterDriverVal;
                },

                // ---- Multi-select spec chips (form factor / driver / connector) ----
                // Chip values are the CANONICAL strings used in database.json
                // (verified against the live catalog), so filtering is an exact
                // case-insensitive match — no substring guessing.
                SPEC_CHIP_DEFS: {
                    formfactor: [
                        { v: 'IEM', icon: 'iem.png' },
                        { v: 'Wireless Earbuds (TWS)', icon: 'tws.png' },
                        { v: 'Earbuds (Wired)', icon: 'earbud.png' },
                        { v: 'Wireless Over-Ear Headphones', icon: 'wireless.png' },
                        { v: 'Over-Ear Headphones (Wired)', icon: 'headphone.png' }
                    ],
                    driver: [
                        { v: 'DD', icon: 'dd.png' },
                        { v: 'BA', icon: 'ba.png' },
                        { v: 'BC', icon: 'bc.png' },
                        { v: 'Planar', icon: 'planar.png' },
                        { v: 'Hybrid', icon: 'hybrid.png' },
                        { v: 'Tribrid', icon: 'trybrid.png' },
                        { v: 'EST', icon: 'est.png' },
                        { v: 'MEMS', icon: 'mems.png' },
                        { v: 'PZT', icon: 'pzt.png' }
                    ],
                    connector: [
                        { v: 'Bluetooth', icon: 'bluetooth.png' },
                        { v: '2-pin', icon: '2pin.png' },
                        { v: 'QDC', icon: 'qdc.png' },
                        { v: 'MMCX', icon: 'mmcx.png' },
                        { v: 'A2DC', icon: 'a2dc.png' },
                        { v: 'Fixed Cable', icon: 'fixed.png' },
                        { v: 'Detachable Cable', icon: 'detach.png' },
                        { v: 'Proprietary', icon: 'proprietary.png' },
                        { v: 'Electrostatic', icon: 'electro.png' }
                    ]
                },

                _getSpecSelection: function(prefix, kind) {
                    try {
                        const el = document.getElementById(prefix + '-filter-' + kind);
                        if (!el) return [];
                        const parsed = JSON.parse(el.value || '[]');
                        return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' && v) : [];
                    } catch (_) {
                        return [];
                    }
                },

                _setSpecSelection: function(prefix, kind, values) {
                    const el = document.getElementById(prefix + '-filter-' + kind);
                    if (el) el.value = JSON.stringify(values);
                },

                toggleSpecChip: function(prefix, kind, value, btn) {
                    const cur = this._getSpecSelection(prefix, kind);
                    const idx = cur.indexOf(value);
                    if (idx === -1) cur.push(value); else cur.splice(idx, 1);
                    this._setSpecSelection(prefix, kind, cur);
                    if (btn) btn.classList.toggle('on', idx === -1);
                },

                renderSpecChipGrids: function() {
                    // Chips are rendered EXACTLY like the Tuning/Music/Gaming/Other
                    // tag badges (renderPickGrid): bare find-pick-badge buttons,
                    // icon only, no labels or boxes, so every Find tab shares one
                    // visual language and symmetry. Names live on the tooltip.
                    ['find', 'gk', 'ug', 'eg'].forEach(prefix => {
                        Object.keys(this.SPEC_CHIP_DEFS).forEach(kind => {
                            const grid = document.getElementById('grid-' + prefix + '-filter-' + kind);
                            if (!grid || grid.dataset.chipsRendered === '1') return;
                            grid.dataset.chipsRendered = '1';
                            grid.innerHTML = '';
                            this.SPEC_CHIP_DEFS[kind].forEach(def => {
                                const b = document.createElement('button');
                                b.type = 'button';
                                b.className = 'no-tactile find-pick-badge';
                                b.title = def.v;
                                b.setAttribute('data-tooltip', def.v);
                                b.setAttribute('aria-label', kind + ': ' + def.v);
                                b.dataset.value = def.v;

                                const img = document.createElement('img');
                                img.src = 'app/icons/' + def.icon;
                                img.alt = def.v;
                                img.draggable = false;
                                img.onerror = () => {
                                    const s = document.createElement('span');
                                    s.className = 'emoji-font vibrant-emoji leading-none pointer-events-none';
                                    s.style.fontSize = 'var(--pick-emoji, 20px)';
                                    s.textContent = def.v.charAt(0);
                                    img.replaceWith(s);
                                };
                                b.appendChild(img);

                                if (this._getSpecSelection(prefix, kind).indexOf(def.v) !== -1) b.classList.add('on');
                                b.addEventListener('click', () => this.toggleSpecChip(prefix, kind, def.v, b));
                                grid.appendChild(b);
                            });
                        });
                    });
                },

                // Exact-match helpers shared by every spec-filter consumer.
                // Values come from the canonical chip definitions which mirror
                // database.json's form_factor / connector / driver_type fields.
                _connectorMatches: function(db, value) {
                    if (!db || !value) return true;
                    const t = String(value).toLowerCase().trim();
                    const c = db.connector;
                    // Normalize string connectors that may contain comma/slash lists
                    const list = Array.isArray(c) ? c : (typeof c === 'string' ? c.split(/[,/\\|]+/).map(s => s.trim()).filter(Boolean) : []);
                    if (list.length === 0) return false;
                    return list.some(x => String(x).toLowerCase().trim() === t);
                },

                _formFactorMatches: function(db, value) {
                    const itemFF = String((db && db.form_factor) || 'IEM').toLowerCase().trim();
                    const t = String(value).toLowerCase().trim();
                    return itemFF === t || itemFF.includes(t) || t.includes(itemFF);
                },

                readSpecFilterValues: function() {
                    const yearMinEl = document.getElementById('find-filter-year-min');
                    const yearMaxEl = document.getElementById('find-filter-year-max');
                    const priceMinEl = document.getElementById('find-filter-price-min');
                    const priceMaxEl = document.getElementById('find-filter-price-max');
                    return {
                        brand: (document.getElementById('find-filter-brand')?.value || '').trim().toLowerCase(),
                        yearMin: yearMinEl ? (parseInt(yearMinEl.min) || 1995) : 1995,
                        yearMax: yearMaxEl ? (parseInt(yearMaxEl.max) || 2026) : 2026,
                        yearLo: yearMinEl ? (parseInt(yearMinEl.value) || (parseInt(yearMinEl.min) || 1995)) : 1995,
                        yearHi: yearMaxEl ? (parseInt(yearMaxEl.value) || (parseInt(yearMaxEl.max) || 2026)) : 2026,
                        priceMin: priceMinEl ? (parseInt(priceMinEl.min) || 0) : 0,
                        priceMax: priceMaxEl ? (parseInt(priceMaxEl.max) || 3000) : 3000,
                        priceLo: priceMinEl ? (parseInt(priceMinEl.value) || (parseInt(priceMinEl.min) || 0)) : 0,
                        priceHi: priceMaxEl ? (parseInt(priceMaxEl.value) || (parseInt(priceMaxEl.max) || 3000)) : 3000,
                        driver: this._getSpecSelection('find', 'driver'),
                        connector: this._getSpecSelection('find', 'connector'),
                        formFactor: this._getSpecSelection('find', 'formfactor'),
                        picks: (this.selectedPicks || []).slice(),
                    };
                },

                matchesSpecFilters: function(db, f) {
                    if (!db) return false;
                    if (!f) f = this.readSpecFilterValues();

                    if (f.brand) {
                        const dbBrand = String(db.brand || '').toLowerCase();
                        const dbModel = String(db.model || '').toLowerCase();
                        if (!dbBrand.includes(f.brand) && !dbModel.includes(f.brand)) return false;
                    }

                    if (f.yearLo > f.yearMin || f.yearHi < f.yearMax) {
                        const itemYear = parseInt(db.year);
                        if (isNaN(itemYear) || itemYear < f.yearLo || itemYear > f.yearHi) return false;
                    }

                    if (f.priceLo > f.priceMin || f.priceHi < f.priceMax) {
                        const itemPrice = parseFloat(db.price_usd);
                        if (itemPrice == null || isNaN(itemPrice) || itemPrice < f.priceLo || itemPrice > f.priceHi) return false;
                    }

                    // Filter selections are arrays (multi-select chips). Tolerate
                    // legacy single-string values ('any' / a specific value).
                    const driverSel = Array.isArray(f.driver) ? f.driver : ((f.driver && f.driver !== 'any') ? [f.driver] : []);
                    if (driverSel.length) {
                        if (!driverSel.some(v => this.driverFilterMatches(db, v))) return false;
                    }

                    const connSel = Array.isArray(f.connector) ? f.connector : ((f.connector && f.connector !== 'any') ? [f.connector] : []);
                    if (connSel.length) {
                        if (!connSel.some(v => this._connectorMatches(db, v))) return false;
                    }

                    const ffSel = Array.isArray(f.formFactor) ? f.formFactor : ((f.formFactor && f.formFactor !== 'any' && f.formFactor !== 'auto') ? [f.formFactor] : []);
                    if (ffSel.length) {
                        if (!ffSel.some(v => this._formFactorMatches(db, v))) return false;
                    }

                    const metaPicks = (f.picks || []).filter(p => p.kind === 'meta');
                    if (metaPicks.length) {
                        if (!db.tags || !Array.isArray(db.tags)) return false;
                        // Lowercase once per entry (cached) and once per
                        // filter set (precomputed below) instead of per
                        // item × pick on every filter pass.
                        let dbTagsLower = this._tagsLowerCache ? this._tagsLowerCache.get(db) : null;
                        if (!dbTagsLower) {
                            dbTagsLower = db.tags.map(t => String(t).toLowerCase());
                            if (!this._tagsLowerCache) this._tagsLowerCache = new WeakMap();
                            this._tagsLowerCache.set(db, dbTagsLower);
                        }
                        // Local per-call (not cached on f: filter objects can be
                        // reused across runs with different picks).
                        const metaReqLower = metaPicks.map(p => String(p.value).toLowerCase());
                        const anyTag = metaReqLower.some(reqLower => {
                            return dbTagsLower.some(t => t.includes(reqLower) || reqLower.includes(t));
                        });
                        if (!anyTag) return false;
                    }

                    return true;
                },

                // Memoised so concurrent callers (boot + a scan pressed early)
                // share one load instead of each starting their own fetch.
                _dbLoadPromise: null,

                // Memoised search-normalised text for the three Find-tab search
                // boxes (Flagship / owned-IEM / taste favourites).
                //
                // These used PEQDB_Module.matchSearchTokens, which re-runs
                // normalizeSearchText — ~20 global regex passes, two of which
                // roughly double the string — on the HAYSTACK for every single
                // dataset entry on every keystroke. With a ~5,000-entry
                // catalogue that is 100k regex passes per 160ms debounce tick.
                // PEQDB_Module already ships the two halves this needs
                // (getSearchNorm's memo + matchSearchTokensNorm); the Database
                // list uses them. Memoising onto the item itself keeps the cache
                // naturally bounded at one string per entry, with no global Map
                // to grow or evict.
                _fnSearchNorm: function(item, withFiles) {
                    if (!item) return '';
                    if (withFiles) {
                        if (item._fnSearchNormFull === undefined) {
                            const filePaths = Array.isArray(item.files) ? item.files.join(' ') : (item.primaryFilePath || '');
                            item._fnSearchNormFull = PEQDB_Module.normalizeSearchText(
                                `${item.name || ''} ${item.brand || ''} ${item.model || ''} ${item.variant || ''} ${filePaths} ${item.searchKey || ''}`
                            );
                        }
                        return item._fnSearchNormFull;
                    }
                    if (item._fnSearchNorm === undefined) {
                        item._fnSearchNorm = PEQDB_Module.normalizeSearchText(
                            `${item.name} ${item.brand || ''} ${item.model || ''}`
                        );
                    }
                    return item._fnSearchNorm;
                },

                loadDatabase: async function() {
                    if (this._dbLoadPromise) return this._dbLoadPromise;
                    this._dbLoadPromise = (async () => {
                    try {

                        // typeof, not window.*: CurveIndexer is a top-level
                        // const (peqdb-module.js), never assigned to window.
                        //
                        // Await CurveIndexer's OWN single-flight catalogue load
                        // rather than re-fetching. PEQDB_Module.init() starts
                        // that load without awaiting it, so FindEngine.init()
                        // (the last module in the boot sequence) used to arrive
                        // while it was still in flight, found `catalog` still
                        // empty, and downloaded + gunzipped + JSON.parsed the
                        // same 2.85 MB payload a SECOND time on the main thread.
                        // It also produced a separate array instance, so the
                        // ~5,100-entry id/name indexes were built twice and
                        // could silently diverge from PEQDB's copy.
                        if (typeof CurveIndexer !== 'undefined' && typeof CurveIndexer.ensureCatalogReady === 'function') {
                            this.iemDatabase = await CurveIndexer.ensureCatalogReady();
                        } else if (typeof CurveIndexer !== 'undefined' && Array.isArray(CurveIndexer.catalog) && CurveIndexer.catalog.length > 0) {
                            this.iemDatabase = CurveIndexer.catalog;
                        } else if (typeof DecompressionStream !== 'undefined') {
                            // Prefer the 12x-smaller .gz (0.22MB vs 2.64MB) and
                            // stream-decompress; fall back to plain JSON.
                            try {
                                const gz = await fetch('database.json.gz');
                                if (!gz.ok || !gz.body) throw new Error('gz unavailable');
                                const text = await new Response(gz.body.pipeThrough(new DecompressionStream('gzip'))).text();
                                this.iemDatabase = JSON.parse(text);
                            } catch (gzErr) {
                                const res = await fetch('database.json');
                                if (res.ok) this.iemDatabase = await res.json();
                            }
                        } else {
                            const res = await fetch('database.json');
                            if (res.ok) this.iemDatabase = await res.json();
                        }
                        // Shape check. The guards above all test `.length === 0`,
                        // and a non-array (a hand-edited database.json whose root
                        // became an object) has `length === undefined`, so
                        // `undefined === 0` is false — every guard would pass and
                        // the first `.filter()`/`.find()` would throw. Normalise
                        // to [] here, once, so all consumers see an array.
                        if (!Array.isArray(this.iemDatabase)) {
                            console.warn('[FindEngine] database.json is not an array; using an empty metadata list.');
                            this.iemDatabase = [];
                        }
                        this.populateCloneSelector();
                        this.populateBrandSuggestions();
                    } catch(e) {
                        console.warn("[FindEngine] Metadata database not found or offline. Filtering fallback in effect.", e);
                        if (!Array.isArray(this.iemDatabase)) this.iemDatabase = [];
                        // Do not memoise a failure: let the next call retry.
                        this._dbLoadPromise = null;
                    }
                    })();
                    return this._dbLoadPromise;
                },

                findModes: [
                    { id: 'tuning', label: 'Tuning', emoji: '🎛️' },
                    { id: 'filters', label: 'Specs', emoji: '🔍' }
                ],
                cycleFindMode: function(dir) {
                    const currentIdx = this.findModes.findIndex(m => m.id === this.findMode);
                    const total = this.findModes.length;
                    const nextIdx = (currentIdx + dir + total) % total;
                    this.setFindMode(this.findModes[nextIdx].id);
                },
                setFindMode: function(mode) {
                    this.findMode = mode;
                    const tuningBtn = document.getElementById('find-mode-tuning-btn');
                    const filtersBtn = document.getElementById('find-mode-filters-btn');
                    const tuningControls = document.getElementById('find-tuning-controls');
                    const filterControls = document.getElementById('find-filter-controls');
                    const targetCurveBlock = document.getElementById('find-target-curve-block');
                    const pickSection = document.getElementById('find-pick-section');

                    if (mode === 'filters') {
                        if (tuningBtn) { tuningBtn.classList.remove('active'); tuningBtn.setAttribute('aria-selected', 'false'); }
                        if (filtersBtn) { filtersBtn.classList.add('active'); filtersBtn.setAttribute('aria-selected', 'true'); }
                        tuningControls.classList.add('hidden');
                        filterControls.classList.remove('hidden');
                        if (targetCurveBlock) targetCurveBlock.classList.add('hidden');
                        if (pickSection) pickSection.classList.remove('hidden');
                        this.fitPickGrid();
                    } else {
                        if (filtersBtn) { filtersBtn.classList.remove('active'); filtersBtn.setAttribute('aria-selected', 'false'); }
                        if (tuningBtn) { tuningBtn.classList.add('active'); tuningBtn.setAttribute('aria-selected', 'true'); }
                        filterControls.classList.add('hidden');
                        tuningControls.classList.remove('hidden');
                        if (targetCurveBlock) targetCurveBlock.classList.remove('hidden');
                        if (pickSection) pickSection.classList.add('hidden');
                    }

                    const stepperLabel = document.getElementById('find-mode-stepper-label');
                    if (stepperLabel) {
                        const mInfo = this.findModes.find(m => m.id === mode) || this.findModes[0];
                        stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${mInfo.emoji}</span> ${mInfo.label}`;
                    }

                    this.drawTargetVisualization();
                },

                getTagAnimationClass: function(tag) {
                    const t = tag.toLowerCase();
                    if (/bass|slam|punch|rumble/i.test(t)) return 'anim-match-punch';
                    if (/bright|detail|sparkle|air|resolv|technical|analytical/i.test(t)) return 'anim-match-pulse';
                    if (/rock|metal|energetic|fun|v-shaped/i.test(t)) return 'anim-match-rock';
                    if (/vocal|presence|dialogue/i.test(t)) return 'anim-match-bounce';
                    if (/gaming|competitive|arcade/i.test(t)) return 'anim-match-snap';
                    if (/flagship|premium|limited|collab|gold/i.test(t)) return 'anim-match-spin';
                    if (/neutral|warm|relaxed|smooth|balanced|reference/i.test(t)) return 'anim-match-breath';
                    return 'anim-match-float';
                },

                _syncDualRangePrefixed: function(prefix, kind) {
                    const minEl = document.getElementById(`${prefix}-filter-${kind}-min`);
                    const maxEl = document.getElementById(`${prefix}-filter-${kind}-max`);
                    const disp = document.getElementById(`${prefix}-filter-${kind}-val`);
                    if (!minEl || !maxEl) return;

                    let minVal = parseInt(minEl.value);
                    let maxVal = parseInt(maxEl.value);

                    const minBound = parseInt(minEl.min);
                    const maxBound = parseInt(maxEl.max);

                    if (document.activeElement === minEl || minEl._isPressed) {
                        if (minVal > maxVal) {
                            minVal = maxVal;
                            minEl.value = minVal;
                        }
                    } else if (document.activeElement === maxEl || maxEl._isPressed) {
                        if (maxVal < minVal) {
                            maxVal = minVal;
                            maxEl.value = maxVal;
                        }
                    } else {
                        if (minVal > maxVal) {
                            minVal = maxVal;
                            minEl.value = minVal;
                        }
                    }

                    const wrap = minEl.closest('.dual-range-wrap');
                    if (wrap) {
                        const pctMin = ((minVal - minBound) / (maxBound - minBound)) * 100;
                        const pctMax = ((maxVal - minBound) / (maxBound - minBound)) * 100;
                        wrap.style.setProperty('--pct-min', pctMin);
                        wrap.style.setProperty('--pct-max', pctMax);

                        if (!wrap._smartPointerBound) {
                            wrap._smartPointerBound = true;

                            const updateZIndexByClick = (e) => {
                                if (minEl._isPressed || maxEl._isPressed) return;
                                const rect = wrap.getBoundingClientRect();
                                const clickX = e.touches ? (e.touches[0]?.clientX || e.changedTouches[0]?.clientX) : e.clientX;
                                if (clickX === undefined) return;

                                const mousePct = Math.max(0, Math.min(100, ((clickX - rect.left) / rect.width) * 100));
                                const pMin = parseFloat(wrap.style.getPropertyValue('--pct-min')) || 0;
                                const pMax = parseFloat(wrap.style.getPropertyValue('--pct-max')) || 100;

                                const midPct = (pMin + pMax) / 2;
                                if (mousePct <= midPct) {
                                    minEl.style.zIndex = "30";
                                    maxEl.style.zIndex = "10";
                                } else {
                                    maxEl.style.zIndex = "30";
                                    minEl.style.zIndex = "10";
                                }
                            };

                            [minEl, maxEl].forEach(el => {
                                el.addEventListener('mousedown', (e) => {
                                    el._isPressed = true;
                                    updateZIndexByClick(e);
                                });
                                el.addEventListener('touchstart', (e) => {
                                    el._isPressed = true;
                                    updateZIndexByClick(e);
                                }, { passive: true });

                                const release = () => { el._isPressed = false; };
                                window.addEventListener('mouseup', release);
                                window.addEventListener('touchend', release);
                            });

                            wrap.addEventListener('mousemove', updateZIndexByClick);
                            wrap.addEventListener('touchstart', updateZIndexByClick, { passive: true });
                        }
                    }

                    if (disp) {
                        const isFullRange = (minVal <= minBound && maxVal >= maxBound);
                        if (isFullRange) {
                            disp.textContent = "Any";
                        } else if (kind === 'price') {
                            disp.textContent = `$${minVal} – $${maxVal}`;
                        } else if (minVal === maxVal) {
                            disp.textContent = `${minVal}`;
                        } else {
                            disp.textContent = `${minVal} – ${maxVal}`;
                        }
                    }
                },
                syncDualRange: function(kind) {
                    this._syncDualRangePrefixed('find', kind);
                },

                populateBrandSuggestions: function() {
                    const sources = [
                        this.iemDatabase,
                        (window.PEQDB && window.PEQDB.STATE && window.PEQDB.STATE.dataset),
                        (typeof CurveIndexer !== 'undefined' && CurveIndexer.catalog) ? CurveIndexer.catalog : null
                    ];
                    const seen = new Set();
                    const brands = [];

                    for (const src of sources) {
                        if (!Array.isArray(src) || src.length === 0) continue;
                        for (let i = 0; i < src.length; i++) {
                            const item = src[i];
                            if (!item) continue;
                            let b = item.brand;
                            if (!b && item.name) {
                                b = item.name.trim().split(' ')[0];
                            }
                            if (b && typeof b === 'string') {
                                const clean = b.trim();
                                const key = clean.toLowerCase();
                                if (clean.length > 1 && !seen.has(key)) {
                                    seen.add(key);
                                    brands.push(clean);
                                }
                            }
                        }
                    }

                    brands.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
                    this.brandSuggestionsList = brands;
                },

                handleBrandSearch: function(query) {
                    if (this._brandSearchTimer) clearTimeout(this._brandSearchTimer);
                    this._brandSearchTimer = setTimeout(() => { this.doBrandFilter(query || ''); }, 130);
                },

                // NOTE: this whole brand-suggestion block is currently
                // unreachable - `handleBrandSearch`, `doBrandFilter` and
                // `selectBrandName` have no caller, and both ids they need
                // (`#find-brand-suggestions-box`, `#find-filter-brand`) are absent
                // from index.html, verified against the live DOM. It is kept
                // rather than deleted because `populateBrandSuggestions` is live
                // (called at :743 and :1101) and shares brandSuggestionsList.
                // The markup is now data-cmd rather than an attribute-form
                // onmousedown, which Chromium refused to compile under the
                // shipped CSP.
                doBrandFilter: function(query) {
                    const container = document.getElementById('find-brand-suggestions-box');
                    if (!container) return;

                    if (!this.brandSuggestionsList || this.brandSuggestionsList.length === 0) {
                        this.populateBrandSuggestions();
                    }

                    const brands = this.brandSuggestionsList || [];
                    const q = (query || '').trim().toLowerCase();
                    const matches = q ? brands.filter(b => b.toLowerCase().includes(q)) : brands;

                    if (matches.length === 0) {
                        container.classList.add('hidden');
                        return;
                    }

                    if (container.parentNode !== document.body) {
                        document.body.appendChild(container);
                    }

                    const inputEl = document.getElementById('find-filter-brand');
                    if (inputEl) {
                        const rect = inputEl.getBoundingClientRect();
                        container.style.position = 'fixed';
                        container.style.left = rect.left + 'px';
                        container.style.top = (rect.bottom + 2) + 'px';
                        container.style.width = rect.width + 'px';
                        container.style.right = 'auto';
                        container.style.zIndex = '99999';
                    }

                    container.innerHTML = matches.map(b => `
                        <div data-cmd="FindEngine.selectBrandName" data-arg-0="${esc(b)}" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800">
                            ${esc(b)}
                        </div>
                    `).join('');
                    container.classList.remove('hidden');
                },

                selectBrandName: function(brand) {
                    const input = document.getElementById('find-filter-brand');
                    const container = document.getElementById('find-brand-suggestions-box');
                    if (input) input.value = brand;
                    if (container) container.classList.add('hidden');
                },

                getDriveability: function(impedance, sensitivity) {
                    if (impedance == null || sensitivity == null || isNaN(impedance) || isNaN(sensitivity)) return 'unknown';
                    if (impedance <= 32 && sensitivity >= 104) return 'easy';
                    if (impedance > 64 || sensitivity < 98) return 'hard';
                    return 'moderate';
                },

                // O(1) entry index: the old two-pass linear find (with a
                // nested files.some + toLowerCase per file per call) ran on
                // ~15 render paths per card. Rebuilt when the DB array changes.
                _dbEntryIndex: null,
                _dbEntryIndexSize: -1,
                _rebuildDbEntryIndex: function() {
                    const byId = new Map();
                    const byFile = new Map();
                    const db = this.iemDatabase || [];
                    for (let i = 0; i < db.length; i++) {
                        const entry = db[i];
                        if (!entry) continue;
                        if (entry.id !== undefined && entry.id !== null) byId.set(entry.id, entry);
                        if (Array.isArray(entry.files)) {
                            for (let k = 0; k < entry.files.length; k++) {
                                const fk = String(entry.files[k]).toLowerCase();
                                if (!byFile.has(fk)) byFile.set(fk, entry);
                            }
                        }
                    }
                    this._dbEntryIndex = { byId, byFile };
                    this._dbEntryIndexSize = db.length;
                },
                getDbEntry: function(item) {
                    if (!this.iemDatabase || this.iemDatabase.length === 0) return null;
                    if (!this._dbEntryIndex || this._dbEntryIndexSize !== this.iemDatabase.length) {
                        this._rebuildDbEntryIndex();
                    }
                    const byIdHit = this._dbEntryIndex.byId.get(item.id);
                    if (byIdHit) return byIdHit;
                    return this._dbEntryIndex.byFile.get(String(item.id).toLowerCase()) || null;
                },

                checkInitialProgress: function() {
                    const isIndexed = localStorage.getItem('squig_db_indexed') === 'true';
                    const progressContainer = document.getElementById('find-progress-container');
                    if (isIndexed && progressContainer) {
                        progressContainer.classList.add('hidden');
                        this.populateCloneSelector();
                    } else {
                        this.updateIndexingProgressBar();

                        setTimeout(() => {
                            if (progressContainer && !progressContainer.classList.contains('hidden')) {
                                progressContainer.classList.add('hidden');
                                // Do NOT claim the database finished loading here.
                                // This timer fires purely because the bar was still
                                // on screen, which is equally true when the load
                                // failed; setting databaseFullyLoaded = true made a
                                // failed catalogue load indistinguishable from a
                                // slow-but-successful one.
                                console.warn("[FindEngine] Progress bar auto-hidden via safety timer.");
                            }
                        }, 3000);
                    }
                },

                bindEvents: function() {
                    const blindChk = document.getElementById('find-blind-mode');
                    if (blindChk) {
                        blindChk.addEventListener('change', () => {
                            if (this._lastMatches) {
                                this.renderMatches(this._lastMatches);
                            }
                        });
                    }

                    document.addEventListener('click', (e) => {
                        const isDropdownClick = e.target.closest('[id^="menu-find-filter-"]') ||
                                                e.target.closest('button[onclick*="toggleCustomMenu"]');
                        if (!isDropdownClick) {
                            ['driver', 'connector', 'tag', 'formfactor'].forEach(k => {
                                const menu = document.getElementById(`menu-find-filter-${k}`);
                                if (menu && !menu.classList.contains('hidden')) {
                                    menu.classList.add('hidden');
                                }
                            });
                        }
                    });

                    document.addEventListener('click', (e) => {
                        [
                            { input: 'brand', box: 'brand-suggestions' },
                            { input: 'find-taste-search', box: 'find-taste-results' },
                            { input: 'find-upgrade-search', box: 'find-upgrade-search-results' },
                            { input: 'find-gk-search', box: 'find-gk-search-results' }
                        ].forEach(pair => {
                            const inputEl = document.getElementById(pair.input);
                            const boxEl = document.getElementById(pair.box);
                            if (!boxEl || boxEl.classList.contains('hidden')) return;
                            if ((inputEl && inputEl.contains(e.target)) || boxEl.contains(e.target)) return;
                            boxEl.classList.add('hidden');
                        });
                    }, true);

                    document.addEventListener('scroll', () => {
                        const box = document.getElementById('brand-suggestions');
                        if (box && !box.classList.contains('hidden')) box.classList.add('hidden');
                    }, true);

                    this.syncDualRange('price');
                    this.syncDualRange('year');
                    this.populateBrandSuggestions();

                    const sliders = ['find-bass', 'find-sub', 'find-punch', 'find-warm', 'find-vocals', 'find-treble', 'find-smooth'];
                    sliders.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.addEventListener('input', () => {
                                if (this.isClonedModeActive) {
                                    this.deactivateEQBaseClone();
                                }
                                if (this.clonedTargetInterp) {
                                    this.clonedTargetInterp = null;
                                    const btn = document.getElementById('find-baseline-btn');
                                    if (btn) {
                                        const opt = this.baselineOptions[this.currentBaselineIndex];
                                        btn.textContent = `${opt.emoji} Baseline: ${opt.label}`;
                                    }
                                }
                                this.updateSliderUI(id);
                                this.drawTargetVisualization();
                                this.drawTasteRadar();
                            });
                        }
                    });
                },

                updateSliderUI: function(id) {
                    const el = document.getElementById(id);
                    const val = parseFloat(el.value);
                    const display = document.getElementById(id + '-val');
                    if (!display) return;

                    let label = "Neutral";
                    if (val > 0) label = `+${val.toFixed(1)} dB`;
                    else if (val < 0) label = `${val.toFixed(1)} dB`;

                    display.textContent = label;
                },

                resetSlidersToZero: function() {
                    const sliders = ['find-bass', 'find-sub', 'find-punch', 'find-warm', 'find-vocals', 'find-treble', 'find-smooth'];
                    sliders.forEach(id => {
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = 0;
                            // Programmatic value changes fire no input event, so
                            // the gradient fill must be repainted here or the
                            // bar stays stuck at the pre-reset position.
                            if (window.paintSliderTrack) window.paintSliderTrack(el);
                            else if (window.syncGlobalSliders) window.syncGlobalSliders(el);
                        }
                        this.updateSliderUI(id);
                    });
                },

                cycleBaseline: function(dir) {

                    this.clonedTargetInterp = null;
                    if (this.isClonedModeActive) {
                        this.deactivateEQBaseClone();
                    }

                    const step = (typeof dir === 'number' && isFinite(dir)) ? (dir >= 0 ? 1 : -1) : 1;
                    const total = this.baselineOptions.length;
                    this.currentBaselineIndex = (this.currentBaselineIndex + step + total) % total;
                    const opt = this.baselineOptions[this.currentBaselineIndex];

                    const btn = document.getElementById('find-baseline-btn');
                    if (btn) {
                        btn.textContent = `${opt.emoji} Baseline: ${opt.label}`;
                    }

                    this.resetSlidersToZero();
                    this.drawTargetVisualization();
                    showToast(`Toggled baseline to "${opt.label}"!`, "🎯");
                },

                startActiveSlotObserver: function() {
                    if (this._activeSlotObserverStarted) return;
                    this._activeSlotObserverStarted = true;

                    this._activeSlotIntervalId = setInterval(() => {
                        if (document.hidden) return;
                        // Skip work entirely when the Find tab isn't visible —
                        // the next tick after returning corrects any stale state.
                        const findPane = document.getElementById('pane-find');
                        if (findPane && findPane.classList.contains('hidden')) return;
                        const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
                        const btn = document.getElementById('find-clone-btn');
                        const row = document.getElementById('find-clone-actions-row');
                        if (!btn || !row) return;

                        if (baseCurve) {
                            if (!this.isClonedModeActive) {
                                btn.textContent = `📁 Detected: ${baseCurve.name}`;
                                btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 text-[9px] font-bold text-stone-300 flex items-center justify-center px-2 truncate shadow-inner";
                                row.classList.remove('hidden');
                            }
                        } else {
                            if (this.isClonedModeActive) {
                                this.deactivateEQBaseClone();
                            }
                            btn.textContent = "🔒 EQ Base Slot Empty";
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 text-[9px] font-black uppercase text-zinc-555 flex items-center justify-center gap-1.5 shadow-inner cursor-not-allowed";
                            row.classList.add('hidden');
                        }
                    }, 500);
                },

                applyEQBaseClone: function() {
                    const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
                    if (!baseCurve) return;

                    this.isClonedModeActive = true;
                    this.clonedTargetInterp = null;
                    this.resetSlidersToZero();

                    const btn = document.getElementById('find-clone-btn');
                    if (btn) {
                        btn.textContent = `🟢 Active Clone: ${baseCurve.name}`;
                        btn.className = "w-full h-7 bg-gradient-to-r from-emerald-600 to-teal-600 border border-emerald-500/40 text-[9px] font-black uppercase text-white flex items-center justify-center px-2 truncate shadow-md active-btn";
                    }
                    this.drawTargetVisualization();
                    showToast(`Target locked to "${baseCurve.name}"!`, "💾");
                },

                deactivateEQBaseClone: function() {
                    this.isClonedModeActive = false;
                    const btn = document.getElementById('find-clone-btn');
                    const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);

                    if (btn) {
                        if (baseCurve) {
                            btn.textContent = `📁 Detected: ${baseCurve.name}`;
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 text-[9px] font-bold text-stone-300 flex items-center justify-center px-2 truncate shadow-inner";
                        } else {
                            btn.textContent = "🔒 EQ Base Slot Empty";
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 text-[9px] font-black uppercase text-zinc-555 flex items-center justify-center gap-1.5 shadow-inner cursor-not-allowed";
                        }
                    }
                    this.drawTargetVisualization();
                },


                scanTasteMatches: async function() {
                    if (this.isScanning) return;
                    this._tasteHasRun = true;
                    const selected = this.tasteFavorites.map(f => f.id).filter(id => id !== '');
                    if (selected.length < 2) {
                        showToast("Please select at least 2 favorite IEMs to average your taste profile.", "⚠️");
                        return;
                    }

                    this.isScanning = true;
                    this.isClonedModeActive = false;

                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');

                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.add('hidden');
                    if (overlay) overlay.classList.remove('hidden');

                    const title = document.getElementById('find-scanning-title');
                    const subtitle = document.getElementById('find-scanning-subtitle');
                    if (title) title.textContent = "Synthesizing Taste Profile...";
                    if (subtitle) subtitle.textContent = "Averaging favorite frequency curves...";

                    // Everything between raising isScanning and the setTimeout
                    // below used to run UNGUARDED, while the flag was already
                    // true. A throw in the curve loads / interpolation / toast
                    // left isScanning stuck true and the overlay stuck visible,
                    // and since all 5 scan entry points early-return on
                    // `isScanning`, the entire Find tab went dead until restart.
                    // Same shape as scanEndgameSets' try/finally.
                    try {
                    const dataset = PEQDB_Module.STATE.dataset;
                    await Promise.all(selected.map(async (id) => {
                        const item = dataset.find(i => i.id === id);
                        if (item && (!item.data || item.data.length < 2)) {
                            await CurveIndexer.loadCurve(item, 0);
                        }
                    }));

                    const freqs = CurveUtils.generateLogGrid(100);
                    const averagedInterp = new Float32Array(freqs.length).fill(0);
                    let validCount = 0;

                    selected.forEach(id => {
                        const item = dataset.find(i => i.id === id);
                        if (item && item.data) {
                            const normalized = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const interp = CurveUtils.cubicSplineInterpolate(normalized, freqs);
                            for (let i = 0; i < freqs.length; i++) {
                                averagedInterp[i] += interp[i];
                            }
                            validCount++;
                        }
                    });

                    if (validCount === 0) {
                        showToast("Failed to load favorite curves.", "⚠️");
                        this.isScanning = false;
                        if (overlay) overlay.classList.add('hidden');
                        return;
                    }

                    for (let i = 0; i < freqs.length; i++) {
                        averagedInterp[i] /= validCount;
                    }

                    this.clonedTargetInterp = Array.from(averagedInterp);
                    this.drawTargetVisualization();

                    const btn = document.getElementById('find-baseline-btn');
                    if (btn) {
                        btn.textContent = `❤️ Baseline: Custom Taste`;
                    }

                    setTimeout(async () => {
                        try {

                        const batchSize = 25;
                        for (let i = 0; i < dataset.length; i += batchSize) {
                            const chunk = dataset.slice(i, i + batchSize).filter(item => !item.data || item.data.length < 2);
                            if (chunk.length > 0) {
                                await Promise.all(chunk.map(item => CurveIndexer.loadCurve(item, 0)));
                            }
                        }

                        const validItems = dataset.filter(item => item.data !== null && item.data.length >= 2);
                        const canonicalList = await this.buildCanonicalProfiles(validItems);
                        const targetInterp = Array.from(averagedInterp);

                        const matches = [];

                        // Map lookup instead of O(n·m) Array.find per canonical item.
                        const datasetItems = PEQDB_Module.STATE.dataset || [];
                        const datasetById = new Map(datasetItems.map(d => [d.id, d]));

                            canonicalList.forEach(iem => {
                                const matchPct = this._scoreInterp(iem.interp, targetInterp, freqs, true);

                                const dsItem = datasetById.get(iem.id);
                                const rawFiles = dsItem && dsItem.files ? dsItem.files : [];
                                const fileScores = [];

                                if (rawFiles.length > 1) {
                                    rawFiles.forEach(filePath => {
                                        if (dsItem && dsItem.sourcesCache && dsItem.sourcesCache[filePath]) {
                                            const subData = dsItem.sourcesCache[filePath];
                                            const subPct = this.calculateCurveMatchScore(subData, targetInterp, freqs, true);
                                            fileScores.push(subPct);
                                        } else {
                                            fileScores.push(matchPct);
                                        }
                                    });
                                }

                                matches.push({
                                    name: iem.name,
                                    id: iem.id,
                                    data: iem.sourceData,
                                    similarity: matchPct,
                                    fileScores: fileScores,
                                    interp: iem.interp,
                                    isTuningMatch: true
                                });
                            });

                            matches.sort((a, b) => b.similarity - a.similarity);

                            const deduplicatedMatches = [];
                            const seenNames = new Set();
                            for (let i = 0; i < matches.length; i++) {
                                const m = matches[i];
                                const baseName = FindEngine.sanitizeName(m.name);
                                if (!seenNames.has(baseName)) {
                                    seenNames.add(baseName);
                                    deduplicatedMatches.push(m);
                                }
                            }

                            this._lastMatches = deduplicatedMatches;
                            this.renderMatches(this._lastMatches);

                        if (overlay) overlay.classList.add('hidden');
                        this.isScanning = false;

                        const details = document.getElementById('find-taste-details');
                        if (details) details.open = false;

                        App.setFindSection('matches');

                        showToast(`Found ${deduplicatedMatches.length > 100 ? 100 : deduplicatedMatches.length} matches for your taste profile!`, "❤️");
                        } catch (err) {
                            // The scan continues inside this timeout, so errors here
                            // must reset the scanning state themselves or the Find
                            // tab stays wedged behind the overlay forever.
                            console.error("[FindEngine] taste scan failed:", err);
                            this._handleScanError(err);
                        }
                    }, 1000);
                    } catch (err) {
                        // Guard for the pre-timeout region above (curve loads,
                        // interpolation, toast). Without this a throw left
                        // isScanning stuck true and the overlay stuck visible,
                        // and — because all 5 scan entry points early-return on
                        // `isScanning` — the whole Find tab went dead.
                        console.error("[FindEngine] taste scan setup failed:", err);
                        this._handleScanError(err);
                    }
                },

                loadCachedCanonicalProfiles: function() {
                    try {
                        const cached = localStorage.getItem('find_canonical_profiles');
                        if (cached) {
                            this.canonicalCache = JSON.parse(cached);
                        }
                    } catch (e) {
                        console.warn("Failed to load canonical profiles cache.", e);
                    }
                },


                generateTargetCurve: function() {
                    const freqs = CurveUtils.generateLogGrid(100);

                    if (this.clonedTargetInterp) {
                        const targetData = [];
                        for (let i = 0; i < freqs.length; i++) {
                            targetData.push([freqs[i], this.clonedTargetInterp[i]]);
                        }
                        return targetData;
                    }

                    const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
                    if (this.isClonedModeActive && baseCurve) {
                        const normalized = CurveUtils.normalizeTo75dB(baseCurve.data, 500, 75);
                        const baseInterp = CurveUtils.cubicSplineInterpolate(normalized, freqs);

                        const targetData = [];
                        for (let i = 0; i < freqs.length; i++) {
                            targetData.push([freqs[i], baseInterp[i]]);
                        }
                        return targetData;
                    }

                    const opt = this.baselineOptions[this.currentBaselineIndex];
                    let baselineInterp;

                    if (opt.id === 'harman') {
                        const harman = PEQDB_Module.TARGETS.harman.data;
                        const harmanNorm = CurveUtils.normalizeTo75dB(harman, 500, 75);
                        baselineInterp = CurveUtils.cubicSplineInterpolate(harmanNorm, freqs);
                    } else if (opt.id === 'diffuse_field') {
                        const df = PEQDB_Module.TARGETS.diffuse_field.data;
                        const dfNorm = CurveUtils.normalizeTo75dB(df, 500, 75);
                        baselineInterp = CurveUtils.cubicSplineInterpolate(dfNorm, freqs);
                    } else if (opt.id === 'flat') {
                        baselineInterp = new Float32Array(freqs.length).fill(75.0);
                    } else {

                        let matchedTarget = PEQDB_Module.TARGETS[opt.id];
                        const rawData = matchedTarget ? matchedTarget.data : PEQDB_Module.TARGETS.harman.data;
                        const rawNorm = CurveUtils.normalizeTo75dB(rawData, 500, 75);
                        baselineInterp = CurveUtils.cubicSplineInterpolate(rawNorm, freqs);
                    }

                    const bass = parseFloat(document.getElementById('find-bass').value);
                    const sub = parseFloat(document.getElementById('find-sub').value);
                    const punch = parseFloat(document.getElementById('find-punch').value);
                    const warm = parseFloat(document.getElementById('find-warm').value);
                    const vocals = parseFloat(document.getElementById('find-vocals').value);
                    const treble = parseFloat(document.getElementById('find-treble').value);
                    const smooth = parseFloat(document.getElementById('find-smooth').value);

                    const targetData = [];
                    for (let i = 0; i < freqs.length; i++) {
                        const f = freqs[i];
                        let offset = 0;

                        if (f < 150) {
                            const factor = (150 - f) / 130;
                            offset += bass * Math.pow(factor, 1.5);
                        }

                        if (f < 60) {
                            const factor = (60 - f) / 40;
                            offset += sub * Math.pow(factor, 1.2);
                        }

                        offset += 20 * Math.log10(Math.max(1e-6, EQ_Module.getBiquadMagnitude('peaking', f, 100, 1.5, punch)));

                        offset += 20 * Math.log10(Math.max(1e-6, EQ_Module.getBiquadMagnitude('peaking', f, 300, 1.0, warm)));

                        offset += 20 * Math.log10(Math.max(1e-6, EQ_Module.getBiquadMagnitude('peaking', f, 2200, 1.0, vocals)));

                        offset += 20 * Math.log10(Math.max(1e-6, EQ_Module.getBiquadMagnitude('highshelf', f, 7500, 0.7, treble)));

                        offset += 20 * Math.log10(Math.max(1e-6, EQ_Module.getBiquadMagnitude('peaking', f, 5500, 2.5, -smooth * 0.7)));

                        targetData.push([f, baselineInterp[i] + offset]);
                    }

                    return targetData;
                },

                drawTasteRadar: function() {
                    const canvas = document.getElementById('find-taste-radar');
                    if (!canvas) return;
                    const w = canvas.clientWidth, h = canvas.clientHeight;
                    // Cap the hidden-canvas retry chain: the Find pane can stay
                    // at 0x0 indefinitely, and every caller (slider input, tab
                    // switch) started its own unbounded 100 ms re-arm loop.
                    if (w === 0 || h === 0) {
                        const attempt = (arguments[0] || 0) + 1;
                        if (attempt <= 20) setTimeout(() => this.drawTasteRadar(attempt), 100);
                        return;
                    }
                    canvas.width = w; canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, w, h);
                    const sliders = [
                        { id: 'find-bass', label: 'Bass' }, { id: 'find-sub', label: 'Sub' },
                        { id: 'find-punch', label: 'Punch' }, { id: 'find-warm', label: 'Warmth' },
                        { id: 'find-vocals', label: 'Vocals' }, { id: 'find-treble', label: 'Treble' },
                        { id: 'find-smooth', label: 'Smooth' }
                    ];
                    const values = sliders.map(s => {
                        const el = document.getElementById(s.id);
                        return el ? (parseFloat(el.value) + 10) / 20 : 0.5;
                    });
                    const cx = w/2, cy = h/2, radius = Math.min(w,h)*0.35, step = (Math.PI*2)/sliders.length;
                    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
                    for (let r=0.25; r<=1; r+=0.25) {
                        ctx.beginPath();
                        for (let i=0; i<=sliders.length; i++) {
                            const a = step*i - Math.PI/2;
                            const x = cx+Math.cos(a)*radius*r, y = cy+Math.sin(a)*radius*r;
                            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
                        }
                        ctx.closePath(); ctx.stroke();
                    }
                    for (let i=0; i<sliders.length; i++) {
                        const a = step*i - Math.PI/2;
                        ctx.beginPath(); ctx.moveTo(cx,cy);
                        ctx.lineTo(cx+Math.cos(a)*radius, cy+Math.sin(a)*radius); ctx.stroke();
                    }
                    // Canvas2D cannot resolve CSS var() — resolve the theme
                    // accent here, otherwise the polygon renders as a black
                    // blob with a near-invisible outline.
                    const docStyle = getComputedStyle(document.documentElement);
                    const accentColor = (docStyle.getPropertyValue('--accent-blue') || '#6488b0').trim() || '#6488b0';
                    const accentRgbRaw = (docStyle.getPropertyValue('--accent-blue-rgb') || '').trim();
                    const accentRgb = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(accentRgbRaw) ? accentRgbRaw : '100,136,176';
                    ctx.fillStyle = `rgba(${accentRgb}, 0.15)`;
                    ctx.strokeStyle = accentColor; ctx.lineWidth = 2;
                    ctx.beginPath();
                    for (let i=0; i<=sliders.length; i++) {
                        const idx = i%sliders.length, a = step*idx - Math.PI/2;
                        const r = radius*values[idx];
                        const x = cx+Math.cos(a)*r, y = cy+Math.sin(a)*r;
                        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
                    }
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = '#8e8e9c'; ctx.font = 'bold 8px system-ui, sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    sliders.forEach((s,i) => {
                        const a = step*i - Math.PI/2;
                        ctx.fillText(s.label, cx+Math.cos(a)*(radius+16), cy+Math.sin(a)*(radius+16));
                    });
                },

                drawTargetVisualization: function() {
                    const canvas = document.getElementById('find-target-canvas');
                    if (!canvas) return;
                    const ctx = canvas.getContext('2d');

                    const dpr = window.devicePixelRatio || 1;
                    const w = canvas.clientWidth;
                    const h = canvas.clientHeight;

                    if (w === 0 || h === 0) {
                        const attempt = (arguments[0] || 0) + 1;
                        if (attempt <= 20) setTimeout(() => this.drawTargetVisualization(attempt), 100);
                        return;
                    }

                    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
                        canvas.width = Math.floor(w * dpr);
                        canvas.height = Math.floor(h * dpr);
                        ctx.resetTransform();
                        ctx.scale(dpr, dpr);
                    }

                    ctx.clearRect(0, 0, w, h);
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(0, 0, w, h);

                    const regions = [
                        { boundary: 0.22, text: 'BASS' },
                        { boundary: 0.45, text: 'MID-BASS' },
                        { boundary: 0.68, text: 'MIDS' },
                        { boundary: 0.88, text: 'TREBLE' },
                        { boundary: 1.0,  text: 'AIR' }
                    ];

                    let prevX = 0;
                    regions.forEach(r => {
                        const nextX = r.boundary * w;

                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(nextX, 0); ctx.lineTo(nextX, h);
                        ctx.stroke();

                        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                        ctx.font = 'bold 8px system-ui, sans-serif';
                        ctx.textAlign = 'center';
                        ctx.fillText(r.text, prevX + (nextX - prevX) / 2, 12);

                        prevX = nextX;
                    });

                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
                    ctx.lineWidth = 1;
                    const gridFreqs = [100, 1000, 10000];
                    gridFreqs.forEach(f => {
                        const x = w * (Math.log10(f / 20) / Math.log10(20000 / 20));
                        ctx.beginPath();
                        ctx.moveTo(x, 0);
                        ctx.lineTo(x, h);
                        ctx.stroke();
                    });

                    const targetCurve = this.generateTargetCurve();
                    const minDb = 60;
                    const maxDb = 90;

                    const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                    const activeThemeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                    const themeAccent = activeThemeConfig.accent || "#3b82f6";

                    ctx.save();
                    ctx.strokeStyle = themeAccent;
                    ctx.lineWidth = 2.5;
                    ctx.lineJoin = 'round';
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = themeAccent;
                    ctx.beginPath();

                    for (let i = 0; i < targetCurve.length; i++) {
                        const f = targetCurve[i][0];
                        const db = targetCurve[i][1];

                        const x = w * (Math.log10(f / 20) / Math.log10(20000 / 20));
                        const y = h - ((db - minDb) / (maxDb - minDb)) * h;

                        if (i === 0) ctx.moveTo(x, y);
                        else ctx.lineTo(x, y);
                    }
                    ctx.stroke();
                    ctx.restore();
                },

                sanitizeName: function(name) {
                    // Same boundary coercion as the worker's copy of this
                    // function (js/find-worker.js) -- kept in sync since
                    // the main-thread fallback path calls this copy, not
                    // the worker's.
                    if (typeof name !== 'string') name = (name == null) ? '' : String(name);
                    if (!name) return "";
                    let clean = name.toLowerCase();

                    clean = clean.replace(/[\(\[][^\]\)]*[\)\]]/g, '');

                    clean = clean.replace(/\s*x\s*(?:hbb|crinacle|crin|zeos|gizaudio|fresh reviews|jays audio|divinus|seeaudio|akros|ducbloke|community|fresh|z reviews|z)\b/g, '');

                    clean = clean.replace(/\b(?!dudu\b)[ud]{4}\b/g, '');
                    clean = clean.replace(/\b[ud]{2,3}\b/g, '');
                    clean = clean.replace(/\b[01]{2,4}\b/g, '');
                    clean = clean.replace(/\b[1-5]\s+[1-5]\b/g, '');
                    clean = clean.replace(/\b(?:all on|all off|bc on|bc off)\b/g, '');
                    clean = clean.replace(/\s*(?:bass|treble|reference|ref|mid|midrange)?\s*(?:switch|sw|switches)\s*(?:on|off|up|down|1|2|3|4|0)*\b/g, '');

                    clean = clean.replace(/\b\d+\s*(?:Ω|ohm|ohms|o)\b/g, '');
                    clean = clean.replace(/\b(?:high|low|s\s+high|s\s+low)\s*(?:Ω|ohm|ohms|impedance)\b/g, '');

                    clean = clean.replace(/\b(?:\d+\.\d+mm|\d+mm|3\.5|4\.4|usb\s+c|type\s+c|usb|tws|anc|analog|digital|dsp)\b/g, '');
                    clean = clean.replace(/\s*(?:gold|grey|gray|silver|default)?\s*(?:plug|cable|connection|connector|adapter|headband|wire)\b/g, '');

                    clean = clean.replace(/\s*(?:foam|silicone|silicon|yaxi|spinfit|symbio|starline|widebore|narrowbore|final|clear|red|blue|grey|gray|stock|custom|my|dunu\s+ss)\s*(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');
                    clean = clean.replace(/\b(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');

                    clean = clean.replace(/\s*(?:blue|gold|silver|red|black|green|brass|steel|titanium|ti|short\s+black|short\s+red|alt|reference|ref|hifi|pop|vocal|instrumental|monitor|balanced|classic|default|standard|std)?\s*(?:nozzles?|rings?|filters?|mesh|damper|vent|mod|mods|taped?|tanya|microtape)\b/g, '');

                    clean = clean.replace(/\b(?:v\d+(?:\.\d+)?|mk[ivx\d]+b?)\b/g, '');
                    clean = clean.replace(/\b(?:\d+st|\d+nd|\d+rd|\d+th)\s+(?:gen|generation|unit|anniversary|anniv)\b/g, '');
                    clean = clean.replace(/\b(?:og|gen|generation|unit|anniversary|anniv|re\s+set|preprod|pre\s+retail|retail|sample\s*\d*|sample)\b/g, '');

                    clean = clean.replace(/\b(?:edition|standard|std|default|reference|ref|stock|base|baseline|pro\s+max|pro|max|ltd|limited|custom\s+resin|resin)\b/g, '');

                    clean = clean.replace(/\s+/g, ' ').trim();

                    return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                },

                buildCanonicalProfiles: async function(dataset) {
                    const groups = {};
                    const freqs = CurveUtils.generateLogGrid(100);

                    dataset.forEach(item => {
                        // <2-point "curves" interpolate as flat-75 (perfectly
                        // neutral) and score as ideal — skip them, mirroring the
                        // worker's buildCanonicalProfiles guard (find-worker.js)
                        // so the local fallback path can't rank junk entries at
                        // the top when the Worker is unavailable.
                        if (!item.data || item.data.length < 2) return;

                        const nameLower = item.name.toLowerCase();

                        const isImpedanceEntry = /[Ωω]|\b\d+\s*ohms?\b|\badapter\b|\bimpedance\b/i.test(nameLower);

                        const isTipVariant = /\s+(?:foam|silicone|widebore|spinfit|stock|dunu)?\s*tips$/i.test(nameLower);

                        const isSampleVariant = /\s+sample\s*\d*$/i.test(nameLower);

                        if (isImpedanceEntry || isTipVariant || isSampleVariant) {
                            return;
                        }

                        const canonicalName = this.sanitizeName(item.name);
                        if (!groups[canonicalName]) {
                            groups[canonicalName] = [];
                        }
                        groups[canonicalName].push(item);
                    });

                    const canonicalList = [];

                    for (const [name, items] of Object.entries(groups)) {
                        if (items.length === 1) {
                            const item = items[0];
                            const normalized = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const interp = CurveUtils.cubicSplineInterpolate(normalized, freqs);
                            canonicalList.push({
                                name: name,
                                id: item.id,
                                interp: Array.from(interp),
                                sourceData: item.data
                            });
                            continue;
                        }

                        const subgroups = [];
                        for (const item of items) {
                            const normalized = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const interp = CurveUtils.cubicSplineInterpolate(normalized, freqs);

                            let placed = false;
                            for (const sub of subgroups) {

                                let diffSum = 0;
                                for (let i = 0; i < freqs.length; i++) {
                                    diffSum += Math.abs(interp[i] - sub.anchorInterp[i]);
                                }
                                const mae = diffSum / freqs.length;

                                if (mae < 2.0) {
                                    sub.items.push({ item, interp });
                                    placed = true;
                                    break;
                                }
                            }

                            if (!placed) {
                                subgroups.push({
                                    anchorInterp: interp,
                                    items: [{ item, interp }]
                                });
                            }
                        }

                        subgroups.forEach((sub, subIdx) => {
                            let displayName = name;
                            if (subgroups.length > 1) {

                                const variantName = sub.items[0].item.name;
                                displayName = variantName;
                            }

                            const averagedInterp = new Float32Array(freqs.length).fill(0);
                            sub.items.forEach(member => {
                                for (let i = 0; i < freqs.length; i++) {
                                    averagedInterp[i] += member.interp[i];
                                }
                            });

                            for (let i = 0; i < freqs.length; i++) {
                                averagedInterp[i] /= sub.items.length;
                            }

                            canonicalList.push({
                                name: displayName,
                                id: sub.items[0].item.id,
                                interp: Array.from(averagedInterp),
                                sourceData: sub.items[0].item.data
                            });
                        });
                    }

                    return canonicalList;
                },

                // A Worker that has errored, timed out, or stopped replying is
                // PERMANENTLY dead: its `error` event only ever fires once, and
                // a terminated worker never posts again. Leaving it cached meant
                // every later scan attached listeners that could never fire, its
                // promise hung forever, `isScanning` stayed true, the scanning
                // overlay never hid, and — because all 5 scan entry points
                // early-return on `isScanning` — the entire Find tab went dead
                // until the app was restarted. Retiring it means the next scan
                // transparently builds a fresh worker instead.
                _killFindWorker: function(reason) {
                    const w = this._findWorker;
                    this._findWorker = null;
                    // A fresh worker starts with an empty canonical-profile
                    // cache, so any signature we believed it held is void.
                    this._workerCanonicalSig = null;
                    if (w) { try { w.terminate(); } catch (_) {} }
                    console.warn('[FindEngine] retired find worker:', reason);
                },

                // The worker can also die SILENTLY (an OOM or an uncaught throw
                // inside a scan, a message that fails to deserialize). In that
                // case no `error` event fires and the request promise would never
                // settle, so `isScanning` would stay true forever. Cap it: 30s is
                // far longer than any legitimate pass over the catalogue, and
                // falling back to the main-thread scan is a perf cost, not a
                // correctness one.
                WORKER_TIMEOUT_MS: 30000,

                ensureFindWorker: function() {
                    if (this._findWorker) return this._findWorker;
                    if (typeof Worker === 'undefined') return null;
                    try {
                        this._findWorker = new Worker('app/js/find-worker.js');
                        // A fresh worker starts with an empty canonical-profile
                        // cache, so any signature we believed it held is void.
                        this._workerCanonicalSig = null;
                    } catch (e) {
                        console.warn("[FindEngine] Web Worker unavailable:", e);
                        this._findWorker = null;
                    }
                    return this._findWorker;
                },

                // Signature of an item set, byte-identical to itemsKey() in
                // find-worker.js (id + curve length per item). Lets the main
                // thread omit the ~MB-scale curve payload when the worker
                // already holds a memoized canonical list for exactly this set.
                _workerSetSig: function(items) {
                    let s = items.length + '|';
                    for (let i = 0; i < items.length; i++) {
                        const it = items[i];
                        s += (it && it.id !== undefined ? it.id : i) + ':' + (it && it.data ? it.data.length : 0) + ',';
                    }
                    return s;
                },

                // Slim worker payload shared by the tuning and endgame scans.
                // MUST carry price/brand/tags even for tuning: the worker keeps
                // ONE canonical-profile cache keyed by set signature, and
                // scoreEndgameCategories filters on price — a cache poisoned by
                // metadata-less tuning items would empty every endgame pool.
                _buildWorkerSlim: function(items) {
                    const list = [];
                    let dbMap = null;
                    let dbFileMap = null;
                    if (this.iemDatabase && this.iemDatabase.length) {
                        dbMap = new Map();
                        dbFileMap = new Map();
                        this.iemDatabase.forEach(db => {
                            if (!db) return;
                            if (db.id) dbMap.set(db.id, db);
                            // Pre-index file paths once so first-miss
                            // fallbacks don't each scan the whole DB.
                            if (Array.isArray(db.files)) {
                                db.files.forEach(f => {
                                    const k = String(f).toLowerCase();
                                    if (!dbFileMap.has(k)) dbFileMap.set(k, db);
                                });
                            }
                        });
                    }
                    const resolveDb = (item) => {
                        if (!dbMap || !item || !item.id) return null;
                        let db = dbMap.get(item.id);
                        if (!db) {
                            // Same fallback getDbEntry uses: match by file path.
                            db = dbFileMap.get(String(item.id).toLowerCase()) || null;
                            if (db) dbMap.set(item.id, db);
                        }
                        return db;
                    };
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        const db = resolveDb(item) || {};
                        const p = db.price_usd != null ? parseFloat(db.price_usd) : ((item && item.price_usd) != null ? parseFloat(item.price_usd) : null);
                        list.push({
                            id: item && item.id,
                            name: item && item.name,
                            data: (item && item.data) || null,
                            price: (isFinite(p) && p > 0) ? p : null,
                            brand: db.brand || (item && item.brand) || '',
                            tags: Array.isArray(db.tags) ? db.tags : (Array.isArray(item && item.tags) ? item.tags : [])
                        });
                    }
                    return list;
                },

                _runTuningViaWorker: function(token, items, targetInterp, freqs) {
                    const worker = this.ensureFindWorker();
                    if (!worker) return Promise.resolve(null);
                    const sig = this._workerSetSig(items);
                    const workerHasSet = (sig === this._workerCanonicalSig);
                    // Every request carries a unique reqId; the worker echoes
                    // it back, and this listener ignores replies belonging to
                    // any OTHER request (tuning/upgrade/endgame share the same
                    // worker, so every listener observes every message).
                    const reqId = 't' + ((this._workerReqSeq = (this._workerReqSeq || 0) + 1));
                    let slim = null; // built lazily — only when the payload must cross the boundary
                    const buildSlim = () => {
                        if (!slim) slim = this._buildWorkerSlim(items);
                        return slim;
                    };
                    return new Promise((resolve) => {
                        let retriedWithItems = false;
                        let settled = false;
                        let timer = null;
                        // Resolve EXACTLY once, always after detaching listeners
                        // and disarming the timeout. The reprime path re-enters
                        // postMessage, so without a settled latch a late reply
                        // could resolve an already-resolved promise.
                        const done = (v) => {
                            if (settled) return;
                            settled = true;
                            if (timer) { clearTimeout(timer); timer = null; }
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            worker.removeEventListener('messageerror', onErr);
                            resolve(v);
                        };
                        const armTimeout = () => {
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(() => {
                                this._killFindWorker('tuning request timed out after ' + this.WORKER_TIMEOUT_MS + 'ms');
                                done(null);
                            }, this.WORKER_TIMEOUT_MS);
                        };
                        const onMsg = (e) => {
                            const d = e.data || {};
                            if (d.type !== 'result') return;
                            // Drop replies from other requests outright —
                            // including the reprime handshake of a different
                            // scan (only OUR reprime triggers OUR resend).
                            if (d.reqId !== reqId) return;
                            // Worker lost its memoized set (fresh/restarted
                            // worker): resend the full payload once instead of
                            // falling back to the slow main-thread scan.
                            if (!d.ok && d.reprime && !retriedWithItems) {
                                retriedWithItems = true;
                                try {
                                    worker.postMessage({ type: 'tuning', reqId: reqId, items: buildSlim(), targetInterp: targetInterp, freqs: freqs, sig: sig });
                                    this._workerCanonicalSig = sig;
                                    armTimeout();
                                } catch (postErr) {
                                    this._killFindWorker('postMessage failed during reprime');
                                    done(null);
                                }
                                return;
                            }
                            if (this._scanToken !== token) return done(null);
                            // A worker-reported payload failure leaves the worker
                            // itself healthy, so it is NOT retired here.
                            if (!d.ok) { console.warn("[FindEngine] worker tuning failed:", d.error); return done(null); }
                            const list = (d.matches || []).slice();
                            // The worker only echoes slim payloads (no curve data),
                            // so reattach each match's data by id on the main thread.
                            // Without this, match cards lose their sparkline curves
                            // and genre matching falls back to defaults for every box.
                            list.forEach(m => {
                                if (m.data) return;
                                const it = items.find(i => i && i.id === m.id);
                                if (it) m.data = it.data || null;
                            });
                            list.sort((a, b) => b.similarity - a.similarity);
                            done(list);
                        };
                        const onErr = (e) => {
                            console.warn("[FindEngine] worker error:", e && e.message);
                            // The worker is dead. Terminate + drop it from the
                            // cache so the NEXT scan builds a fresh one; leaving
                            // it cached is what used to wedge the whole tab.
                            this._killFindWorker('error event: ' + ((e && e.message) || 'unknown'));
                            done(null);
                        };
                        worker.addEventListener('message', onMsg);
                        worker.addEventListener('error', onErr);
                        // messageerror = the worker tried to send something that
                        // could not be deserialized. Also fatal for this worker.
                        worker.addEventListener('messageerror', onErr);
                        armTimeout();
                        try {
                            if (workerHasSet) {
                                // Same item set the worker already memoized:
                                // send only the target + signature.
                                worker.postMessage({ type: 'tuning', reqId: reqId, targetInterp: targetInterp, freqs: freqs, sig: sig });
                            } else {
                                worker.postMessage({ type: 'tuning', reqId: reqId, items: buildSlim(), targetInterp: targetInterp, freqs: freqs, sig: sig });
                                this._workerCanonicalSig = sig;
                            }
                        } catch (e) {
                            this._killFindWorker('postMessage threw: ' + e.message);
                            done(null);
                        }
                    });
                },

                runTuningScan: async function(items, targetInterp, freqs) {
                    const token = (this._scanToken || 0) + 1;
                    this._scanToken = token;

                    const workerMatches = await this._runTuningViaWorker(token, items, targetInterp, freqs);

                    if (workerMatches !== null && this._scanToken === token) {
                        return workerMatches;
                    }

                    // The worker path (_runTuningViaWorker) replies
                    // {ok:false} on a hostile/malformed item instead of
                    // throwing. This fallback runs the identical scoring
                    // logic directly on the main thread with no such
                    // containment -- an item.name that isn't a string (an
                    // object, a number) would throw inside
                    // buildCanonicalProfiles -> sanitizeName, become an
                    // unhandled promise rejection, and surface as the
                    // full-screen "JS Runtime Exception" overlay instead of
                    // a clean "no matches" result.
                    try {
                        const freqsLocal = freqs || CurveUtils.generateLogGrid(100);
                        const canonicalList = await this.buildCanonicalProfiles(items);
                        const matches = [];
                        canonicalList.forEach(iem => {
                            const matchPct = this._scoreInterp(iem.interp, targetInterp, freqsLocal, true);
                            matches.push({
                                name: iem.name,
                                id: iem.id,
                                data: iem.sourceData,
                                similarity: matchPct,
                                interp: iem.interp,
                                isTuningMatch: true
                            });
                        });
                        matches.sort((a, b) => b.similarity - a.similarity);
                        return matches;
                    } catch (err) {
                        console.warn('[FindEngine] Main-thread tuning scan fallback failed:', err);
                        try { if (typeof showToast === 'function') showToast("Tuning scan failed on this dataset — see console.", "⚠️"); } catch (_) {}
                        return [];
                    }
                },

                _indexProgressTicker: null,

                // Drives the bar while curves are being fetched.
                //
                // This used to be called only twice: once at startup and once
                // when the warmup finished. Each individual curve load did not
                // report in, so the bar was painted at 0%, the fetch loop ran to
                // completion without touching it, and then the container was
                // hidden - it looked like a progress bar that never moved.
                //
                // It is now self-sustaining: if indexing is in flight and nothing
                // is polling, start a ticker. It samples the same real counters
                // as before (curves with data / total), so the percentage is
                // still measured rather than faked, and it stops itself as soon
                // as the database reports fully loaded.
                _ensureIndexProgressTicker: function() {
                    if (PEQDB_Module.databaseFullyLoaded) {
                        if (this._indexProgressTicker) {
                            clearInterval(this._indexProgressTicker);
                            this._indexProgressTicker = null;
                        }
                        return;
                    }
                    if (this._indexProgressTicker) return;
                    const self = this;
                    this._indexProgressTicker = setInterval(function() {
                        if (PEQDB_Module.databaseFullyLoaded) {
                            clearInterval(self._indexProgressTicker);
                            self._indexProgressTicker = null;
                            return;
                        }
                        self.updateIndexingProgressBar();
                    }, 120);
                },

                updateIndexingProgressBar: function() {
                    const progressContainer = document.getElementById('find-progress-container');
                    this._ensureIndexProgressTicker();

                    if (PEQDB_Module.databaseFullyLoaded) {
                        if (progressContainer) progressContainer.classList.add('hidden');
                        return;
                    }

                    const dataset = PEQDB_Module.STATE.dataset;
                    // Shown before the dataset exists so the panel does not sit
                    // blank, and because a zero-length dataset cannot produce a
                    // meaningful percentage.
                    if (!dataset || dataset.length === 0) {
                        if (progressContainer) progressContainer.classList.remove('hidden');
                        const bar0 = document.getElementById('find-progress-bar');
                        const text0 = document.getElementById('find-progress-text');
                        const status0 = document.getElementById('find-progress-status');
                        if (bar0) bar0.style.width = '100%';
                        if (text0) text0.textContent = '';
                        if (status0) status0.textContent = '⏳ Reading database index...';
                        return;
                    }

                    // Prefer the loader's own tally of finished curves. Deriving
                    // progress from the dataset instead cannot work: entries are
                    // created with `data` already populated from cache, so the
                    // observable count does not climb while files are fetched.
                    let indexedCount, totalCount;
                    const prog = (typeof PEQDB_Module.getIndexProgress === 'function')
                        ? PEQDB_Module.getIndexProgress() : null;
                    if (prog && prog.total > 0) {
                        indexedCount = Math.min(prog.done, prog.total);
                        totalCount = prog.total;
                    } else {
                        indexedCount = dataset.filter(item => item.data !== null).length;
                        totalCount = dataset.length;
                    }
                    const percent = Math.round((indexedCount / totalCount) * 100);

                    const bar = document.getElementById('find-progress-bar');
                    const text = document.getElementById('find-progress-text');
                    const status = document.getElementById('find-progress-status');

                    if (bar) bar.style.width = percent + '%';
                    if (text) text.textContent = percent + '%';

                    if (percent >= 100) {
                        if (progressContainer) progressContainer.classList.add('hidden');
                    } else {
                        if (progressContainer) progressContainer.classList.remove('hidden');
                        if (status) status.textContent = `⚡ Indexing: ${indexedCount}/${totalCount} curves cached`;
                    }
                },

                populateCloneSelector: function() {

                },

                scanAndMatch: async function() {
                    if (this.isScanning) return;
                    // Guard the whole pre-timeout region. `await loadDatabase()`
                    // and the curve/dataset setup below used to run while
                    // isScanning was already true but outside any try, so a
                    // throw there left the flag stuck and the overlay visible —
                    // and all 5 scan entry points early-return on `isScanning`.
                    try {
                    this.isScanning = true;

                    if (!this.iemDatabase || this.iemDatabase.length === 0) {
                        await this.loadDatabase();
                    }

                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');

                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.add('hidden');

                    const isTuningMode = (this.findMode === 'tuning');

                    if (isTuningMode) {

                        const dataset = PEQDB_Module.STATE.dataset;
                        if (!dataset || dataset.length === 0) {
                            showToast("Database catalog not loaded yet.", "⚠️");
                            this.isScanning = false;
                            return;
                        }

                        if (overlay) overlay.classList.remove('hidden');
                        const title = document.getElementById('find-scanning-title');
                        const subtitle = document.getElementById('find-scanning-subtitle');
                        if (title) title.textContent = "Analyzing signatures...";
                        if (subtitle) subtitle.textContent = "Checking measurement curves...";

                        setTimeout(async () => {
                            try {

                            const batchSize = 25;
                            for (let i = 0; i < dataset.length; i += batchSize) {
                                const chunk = dataset.slice(i, i + batchSize).filter(item => !item.data || item.data.length < 2);
                                if (chunk.length > 0) {
                                    await Promise.all(chunk.map(item => CurveIndexer.loadCurve(item, 0)));
                                }
                            }

                            let validItems = dataset.filter(item => item.data !== null && item.data.length >= 2);

                            const constrainBySpecs = !!this.tuneWithSpecs;
                            if (constrainBySpecs) {
                                const specFilterValues = FindEngine.readSpecFilterValues();
                                validItems = validItems.filter(item => {
                                    const db = item.dbEntry || FindEngine.getDbEntry(item);
                                    return FindEngine.matchesSpecFilters(db, specFilterValues);
                                });
                            }

                            const targetCurve = this.generateTargetCurve();
                            const freqs = CurveUtils.generateLogGrid(100);
                            const targetInterp = CurveUtils.normalizeTo75dB(targetCurve, 500, 75).map(pt => pt[1]);

                            const matches = await this.runTuningScan(validItems, targetInterp, freqs);

                            const deduplicatedMatches = [];
                            const seenNames = new Set();
                            for (let i = 0; i < matches.length; i++) {
                                const m = matches[i];
                                const baseName = FindEngine.sanitizeName(m.name);
                                if (!seenNames.has(baseName)) {
                                    seenNames.add(baseName);
                                    deduplicatedMatches.push(m);
                                }
                            }

                            this._lastMatches = deduplicatedMatches;
                            this.renderMatches(this._lastMatches);

                            if (overlay) overlay.classList.add('hidden');
                            this.isScanning = false;
                            } catch (err) {
                                this._handleScanError(err);
                            }
                        }, 400);

                    } else {

                        if (!this.iemDatabase || this.iemDatabase.length === 0) {
                            showToast("Database failed to load — filters inactive.", "⚠️");
                            this.isScanning = false;
                            return;
                        }

                        if (overlay) overlay.classList.remove('hidden');

                        setTimeout(async () => {
                            try {

                            const specFilterValues = this.readSpecFilterValues();

                            let dbMatches = this.iemDatabase.filter(db => FindEngine.matchesSpecFilters(db, specFilterValues));

                            console.log("[FindEngine] Specs scan: iemDatabase.length =", this.iemDatabase ? this.iemDatabase.length : 'null',
                                "| dbMatches.length =", dbMatches.length, "| filterValues =", specFilterValues);

                            dbMatches.sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));

                            const matches = dbMatches.map(db => {
                                return {
                                    name: db.variant ? `${db.brand} ${db.model} (${db.variant})` : `${db.brand} ${db.model}`,
                                    id: db.id,
                                    isTuningMatch: false,
                                    dbEntry: db
                                };
                            });

                            const dataset = PEQDB_Module.STATE.dataset || [];
                            // Index the dataset once: id -> item and primaryFile -> item.
                            // The per-match lookups below were dataset.find() scans
                            // inside the batch loop (O(matches x dataset)).
                            const datasetById = new Map();
                            const datasetByFile = new Map();
                            dataset.forEach(item => {
                                if (item && item.id !== undefined && !datasetById.has(item.id)) datasetById.set(item.id, item);
                                if (item && item.primaryFilePath && !datasetByFile.has(item.primaryFilePath)) datasetByFile.set(item.primaryFilePath, item);
                                if (item && Array.isArray(item.files)) item.files.forEach(f => { if (!datasetByFile.has(f)) datasetByFile.set(f, item); });
                            });
                            const LOAD_BATCH = 25;
                            for (let bi = 0; bi < matches.length; bi += LOAD_BATCH) {
                                const batch = matches.slice(bi, bi + LOAD_BATCH);
                                await Promise.all(batch.map(async (m) => {
                                    const db = m.dbEntry;
                                    const targetId = db ? db.id : m.id;
                                    let item = datasetById.get(targetId);
                                    if (!item && db && db.files && db.files.length > 0) {
                                        item = datasetByFile.get(db.files[0]) || null;
                                    }
                                    if (item) {
                                        if (!item.data || item.data.length < 2) {
                                            await CurveIndexer.loadCurve(item, 0);
                                        }
                                        m.data = item.data;
                                        db.data = item.data;
                                    }
                                }));
                                if (document.getElementById('find-scanning-title')) {
                                    document.getElementById('find-scanning-title').textContent = `Loading curves... ${Math.min(bi + LOAD_BATCH, matches.length)}/${matches.length}`;
                                }
                            }

                            const loadedCount = matches.filter(m => m.data && m.data.length >= 2).length;
                            console.log("[FindEngine] Specs scan: matches.length =", matches.length,
                                "| with curve data =", loadedCount);

                            this._lastMatches = matches;
                            this.renderMatches(this._lastMatches);

                            if (overlay) overlay.classList.add('hidden');
                            this.isScanning = false;
                            } catch (err) {
                                this._handleScanError(err);
                            }
                        }, 300);
                    }
                    } catch (err) {
                        console.error("[FindEngine] scan setup failed:", err);
                        this._handleScanError(err);
                    }
                },

                _handleScanError: function(err) {
                    console.error("[FindEngine] Scan error:", err);
                    this.isScanning = false;
                    try {
                        const overlay = document.getElementById('find-scanning-overlay');
                        if (overlay) overlay.classList.add('hidden');
                        const bar = document.getElementById('find-results-count');
                        const txt = document.getElementById('find-results-count-text');
                        if (bar) bar.classList.remove('hidden');
                        if (txt) {
                            txt.textContent = '⚠️ ' + ((err && err.message) ? err.message : String(err));
                            txt.className = 'text-[9.5px] font-black uppercase tracking-wider text-rose-400';
                        }
                    } catch (_) {}
                },

                tuneWithSpecs: false,

                toggleTuneWithSpecs: function() {
                    this.tuneWithSpecs = !this.tuneWithSpecs;
                    this.updateTuneWithSpecsUI();
                    showToast(this.tuneWithSpecs
                        ? "Specs filters will now also apply to Tuning matches."
                        : "Tuning matches will no longer be filtered by specs.", this.tuneWithSpecs ? "🔒" : "🔓");
                },

                updateTuneWithSpecsUI: function() {
                    const btn = document.getElementById('find-tune-specs-toggle-btn');
                    const label = document.getElementById('find-tune-specs-toggle-label');
                    if (btn) btn.classList.toggle('is-on', !!this.tuneWithSpecs);
                    if (label) label.textContent = this.tuneWithSpecs ? '🔒 FILTER BY SPECS: ON' : '🔒 FILTER BY SPECS: OFF';
                },

                // Unified driveability math. Three systems previously
                // disagreed (this badge, getDriveability's imp/sens cutoffs,
                // and the Power tab's dacLimits ratios): the same IEM could
                // show "Phone OK" in one card and "Desktop Amp Needed" in
                // another. This one now (a) reads the SAME SPL target the
                // Power tab uses (IEM_Module.getListeningSplTarget), and
                // (b) honors dB/V vs dB/mW — they differ by 10*log10(1000/Z),
                // ~15 dB at 32Ω, which previously flipped the verdict.
                // Thresholds mirror the Power tab's dacLimits voltages
                // (Phone 0.4V, Laptop 1.0V, Dongle 2.0V, Desktop 4.0V) with a
                // little headroom margin.
                getDriveabilityStatus: function(impedance, sensitivity, sensUnit) {
                    // 0/empty sensitivity means "no data" in hand-maintained DB
                    // entries — treat as unknown rather than computing an
                    // absurd requirement from 0 dB/mW.
                    if (impedance == null || sensitivity == null || !sensitivity) return null;
                    const imp = parseFloat(impedance);
                    const sens = parseFloat(sensitivity);
                    if (!Number.isFinite(imp) || imp <= 0 || !Number.isFinite(sens)) return null;

                    let splTarget = 115;
                    if (typeof IEM_Module !== 'undefined' && IEM_Module.getListeningSplTarget) {
                        try { splTarget = IEM_Module.getListeningSplTarget(); } catch (_) {}
                    }

                    let vReq;
                    if (sensUnit === 'V') {
                        vReq = Math.pow(10, (splTarget - sens) / 20);
                    } else {
                        const pReq = Math.pow(10, (splTarget - sens) / 10); // mW, dB/mW
                        vReq = Math.sqrt((pReq * imp) / 1000);
                    }

                    if (vReq <= 0.45) return { label: '📱 Phone OK', color: 'text-emerald-400' };
                    if (vReq <= 1.2) return { label: '🔌 Dongle Rec', color: 'text-amber-400' };
                    if (vReq <= 3.5) return { label: '🎧 Portable/DAC Amp', color: 'text-sky-400' };
                    return { label: '🖥️ Desktop Amp Needed', color: 'text-rose-400' };
                },

                calculateEQFeasibility: function(candidateInterp, targetInterp, freqs) {
                    if (!candidateInterp || !targetInterp || !freqs) return null;

                    let sumTarget = 0, sumCandidate = 0, alignCount = 0;
                    for (let i = 0; i < freqs.length; i++) {
                        if (freqs[i] >= 200 && freqs[i] <= 4000) {
                            sumTarget += targetInterp[i];
                            sumCandidate += candidateInterp[i];
                            alignCount++;
                        }
                    }
                    const offsetK = alignCount > 0 ? (sumTarget - sumCandidate) / alignCount : 0;

                    let maxBoost = 0;
                    let maxBoostHz = 1000;
                    let totalBoost = 0;
                    let boostCount = 0;

                    for (let i = 0; i < freqs.length; i++) {
                        const f = freqs[i];
                        if (f < 20 || f > 10000) continue;

                        const alignedCandDb = candidateInterp[i] + offsetK;
                        const boostNeeded = targetInterp[i] - alignedCandDb;

                        if (boostNeeded > maxBoost) {
                            maxBoost = boostNeeded;
                            maxBoostHz = Math.round(f);
                        }
                        if (boostNeeded > 0) {
                            totalBoost += boostNeeded;
                            boostCount++;
                        }
                    }

                    const avgBoost = boostCount > 0 ? totalBoost / boostCount : 0;
                    const score = Math.max(0, Math.min(100, Math.round(100 - (maxBoost * 7.0) - (avgBoost * 3.0))));

                    let badge = { label: '🟢 EQ Friendly', color: 'text-emerald-400' };
                    if (maxBoost > 7.0 || score < 50) {
                        badge = { label: '🔴 Heavy EQ', color: 'text-rose-400' };
                    } else if (maxBoost > 3.8 || score < 75) {
                        badge = { label: '🟡 Mod EQ', color: 'text-amber-400' };
                    }

                    let region = "Vocal/Mid";
                    if (maxBoostHz <= 250) region = "Bass";
                    else if (maxBoostHz > 4000) region = "Treble";

                    const preampDrop = Math.max(0.0, maxBoost * 1.05).toFixed(1);
                    const formattedHz = maxBoostHz >= 1000 ? (maxBoostHz / 1000).toFixed(1) + "kHz" : maxBoostHz + "Hz";

                    let tooltip = `EQ Suggestion: Great match! Needs only minor tweaks (<+2dB). Set Preamp to -2.0dB to prevent clipping.`;
                    if (maxBoost > 2.0) {
                        tooltip = `EQ Suggestion: Needs +${maxBoost.toFixed(1)}dB ${region} boost at ${formattedHz}. Set Preamp to -${preampDrop}dB to prevent clipping.`;
                    }

                    return { score, maxBoost: maxBoost.toFixed(1), badge, tooltip };
                },

                activeRightTab: 'taste',















                cardState: {},





















                cardRoleOptions: [
                    { role: 'base', label: '<span class="emoji-font vibrant-emoji text-lg mr-1 anim-toggle-pop">📈</span> Load as Base' },
                    { role: 'target', label: '<span class="emoji-font vibrant-emoji text-lg mr-1 anim-toggle-pop">🎯</span> Load as Target' },
                    { role: 'reference', label: '<span class="emoji-font vibrant-emoji text-lg mr-1 anim-toggle-pop">🆚</span> Load as Reference' },
                    { role: 'autoeq', label: '<span class="emoji-font vibrant-emoji text-lg mr-1 anim-toggle-pop">🪄</span> AutoEQ To This' }
                ],

                tuningPresets: [
                    { key: 'neutral', label: '🎼 Preset: Neutral', values: { bass: 0, sub: 0, punch: 0, warm: 0, vocals: 0, treble: 0, smooth: 0 } },
                    { key: 'basshead', label: '💥 Basshead Boost', values: { bass: 6, sub: 4, punch: 3, warm: 2, vocals: 0, treble: -1, smooth: 1 } },
                    { key: 'vocal', label: '🎤 Vocal Forward', values: { bass: -1, sub: -1, punch: 0, warm: 2, vocals: 4, treble: 2, smooth: 1 } },
                    { key: 'crisp', label: '✨ Crisp & Airy', values: { bass: 0, sub: 1, punch: 0, warm: -1, vocals: 1, treble: 4, smooth: 2 } },
                    { key: 'gaming', label: '🎮 Footstep Focus', values: { bass: -2, sub: -4, punch: 1, warm: 0, vocals: 3, treble: 3, smooth: 0 } },
                    { key: 'chill', label: '☕ Chill Lo-Fi', values: { bass: 3, sub: 2, punch: 1, warm: 3, vocals: -1, treble: -3, smooth: 3 } },
                    { key: 'vshape', label: '🔺 V-Shaped', values: { bass: 5, sub: 4, punch: 2, warm: -1, vocals: -2, treble: 4, smooth: 0 } }
                ],
                currentTuningPresetIdx: 0,


                updateFloatingCompareBar: function() {
                    const checked = document.querySelectorAll('.find-compare-cb:checked');
                    const bar = document.getElementById('find-floating-compare-bar');
                    const text = document.getElementById('find-compare-bar-text');

                    if (!bar) return;

                    if (checked.length >= 2 && checked.length <= 4) {
                        if (text) text.textContent = `📊 ${checked.length} IEMs Selected`;
                        bar.classList.remove('hidden');
                    } else {
                        bar.classList.add('hidden');
                    }
                },

                cycleCardSource: function(idx, dir) {
                    let rawFiles = [];
                    let curveIdToLoad = null;
                    let stepNum = null;

                    if (typeof idx === 'string' && idx.startsWith('ug_')) {
                        stepNum = parseInt(idx.replace('ug_', ''));
                        const pool = this.upgradeStepCandidates[stepNum];
                        if (!pool) return;
                        const curIdx = this.upgradeStepIndices[stepNum] || 0;
                        const c = pool[curIdx];
                        if (!c) return;

                        const dbEntry = c.db || this.getDbEntry(c.item) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === c.item.id) : null);
                        rawFiles = (dbEntry && Array.isArray(dbEntry.files)) ? dbEntry.files : (c.item.files || []);
                        curveIdToLoad = dbEntry ? dbEntry.id : c.item.id;
                    } else {
                        const match = this._lastMatches ? this._lastMatches[idx - 1] : null;
                        if (!match) return;

                        const dbEntry = match.dbEntry || this.getDbEntry(match) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === match.id) : null);
                        rawFiles = (dbEntry && Array.isArray(dbEntry.files)) ? dbEntry.files : (match.files || []);
                        curveIdToLoad = dbEntry ? dbEntry.id : match.id;
                    }

                    if (rawFiles.length <= 1) return;

                    if (!this.cardState[idx]) this.cardState[idx] = { srcIdx: 0, roleIdx: 0 };
                    const total = rawFiles.length;
                    this.cardState[idx].srcIdx = (this.cardState[idx].srcIdx + dir + total) % total;
                    const currentSrcIdx = this.cardState[idx].srcIdx;

                    const filePath = rawFiles[currentSrcIdx];
                    const parts = filePath.split('/');
                    const sourceName = parts.length >= 2 ? parts[parts.length - 2] : 'Source';
                    const fileNameRaw = parts[parts.length - 1].replace(/\.[^/.]+$/, '');

                    const labelEl = document.getElementById(`label-src-stepper-${idx}`);
                    if (labelEl) {
                        const rawHtml = `<span class="text-stone-300 font-bold">${currentSrcIdx + 1}/${total}</span> <span class="text-[var(--accent-blue)] font-black">${sourceName}</span> <span class="text-stone-200 font-bold">(${fileNameRaw})</span>`;
                        labelEl.classList.remove('marquee-orbit-active');
                        labelEl.style.removeProperty('--marquee-orbit-duration');
                        labelEl.innerHTML = rawHtml;
                        void labelEl.offsetWidth;
                        activateOrbitMarquee(labelEl);
                    }

                    const dsItem = PEQDB_Module.STATE.dataset.find(d => d.id === curveIdToLoad);
                    if (dsItem) {
                        CurveIndexer.loadCurve(dsItem, currentSrcIdx).then(() => {
                            if (stepNum !== null) {
                                this.drawUpgradeStepSparkline(stepNum);
                            } else {
                                const subData = (dsItem.sourcesCache && dsItem.sourcesCache[filePath]) ? dsItem.sourcesCache[filePath] : dsItem.data;
                                if (subData) {
                                    const sparkCanvas = document.getElementById('spark-' + idx);
                                    if (sparkCanvas) {
                                        const sw = sparkCanvas.clientWidth || 120;
                                        const sh = sparkCanvas.clientHeight || 40;
                                        const sctx = sparkCanvas.getContext('2d');
                                        sctx.clearRect(0, 0, sw, sh);
                                        sctx.fillStyle = '#000000';
                                        sctx.fillRect(0, 0, sw, sh);

                                        const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                                        const themeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                                        const sparkColor = themeConfig.accent || '#3b82f6';

                                        const norm = CurveUtils.normalizeTo75dB(subData, 500, 75);
                                        sctx.strokeStyle = sparkColor;
                                        sctx.lineWidth = 2.2;
                                        sctx.lineJoin = 'round';
                                        sctx.beginPath();
                                        for (let i = 0; i < norm.length; i++) {
                                            const x = (Math.log10(norm[i][0] / 20) / Math.log10(20000 / 20)) * sw;
                                            const y = sh - ((norm[i][1] - 60) / 30) * sh;
                                            if (i === 0) sctx.moveTo(x, y);
                                            else sctx.lineTo(x, y);
                                        }
                                        sctx.stroke();
                                    }
                                }
                            }
                        });
                    }
                },

                cycleCardRole: function(idx, dir) {
                    if (!this.cardState[idx]) this.cardState[idx] = { srcIdx: 0, roleIdx: 0 };
                    const total = this.cardRoleOptions.length;
                    this.cardState[idx].roleIdx = (this.cardState[idx].roleIdx + dir + total) % total;
                    const currentRole = this.cardRoleOptions[this.cardState[idx].roleIdx];

                    const labelEl = document.getElementById(`label-role-stepper-${idx}`);
                    if (labelEl) {
                        labelEl.innerHTML = currentRole.label;
                    }
                },

                loadCardToGraph: async function(idx) {
                    let curveIdToLoad = null;
                    let srcIdx = 0;
                    let role = 'reference';
                    let candidateName = '';

                    if (typeof idx === 'string' && idx.startsWith('ug_')) {
                        const stepNum = parseInt(idx.replace('ug_', ''));
                        const pool = this.upgradeStepCandidates[stepNum];
                        if (!pool) return;
                        const curIdx = this.upgradeStepIndices[stepNum] || 0;
                        const c = pool[curIdx];
                        if (!c) return;

                        const st = this.cardState[idx] || { srcIdx: 0, roleIdx: 0 };
                        srcIdx = st.srcIdx || 0;
                        const roleOpt = this.cardRoleOptions[st.roleIdx || 0];
                        role = roleOpt ? roleOpt.role : 'reference';

                        const dbEntry = c.db || this.getDbEntry(c.item) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === c.item.id) : null);
                        curveIdToLoad = dbEntry ? dbEntry.id : c.item.id;
                        candidateName = c.item ? c.item.name : '';
                    } else if (typeof idx === 'string' && idx.startsWith('eg_')) {
                        // Endgame cards (value strip 'eg_val' + category
                        // 'eg_<catId>'): resolve the currently-displayed pool
                        // entry from the last scan's state. The numeric
                        // fallback below used to receive these keys and
                        // silently no-opped ('eg_basshead' - 1 = NaN), leaving
                        // every Endgame Load button dead.
                        if (!this._lastEndgame) return;
                        const st = this.cardState[idx] || { srcIdx: 0, roleIdx: 0 };
                        srcIdx = st.srcIdx || 0;
                        const roleOpt = this.cardRoleOptions[st.roleIdx || 0];
                        role = roleOpt ? roleOpt.role : 'reference';

                        let entry = null;
                        if (idx === 'eg_val') {
                            const pool = (this._lastEndgame._value && this._lastEndgame._value.pool) || [];
                            const vi = (this._endgameState && this._endgameState._value || 0) % (pool.length || 1);
                            entry = pool[vi];
                        } else {
                            const catId = idx.slice(3);
                            const pool = (this._lastEndgame[catId] && this._lastEndgame[catId].pool) || [];
                            const ci = (this._endgameState && this._endgameState[catId] || 0) % (pool.length || 1);
                            entry = pool[ci];
                        }
                        if (!entry || !entry.id) return;

                        const dbEntry = this.getDbEntry(entry) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === entry.id) : null);
                        curveIdToLoad = dbEntry ? dbEntry.id : entry.id;
                        candidateName = entry.name || '';
                    } else {
                        const match = this._lastMatches ? this._lastMatches[idx - 1] : null;
                        if (!match) return;

                        const st = this.cardState[idx] || { srcIdx: 0, roleIdx: 0 };
                        srcIdx = st.srcIdx || 0;
                        const roleOpt = this.cardRoleOptions[st.roleIdx || 0];
                        role = roleOpt ? roleOpt.role : 'reference';

                        curveIdToLoad = match.dbEntry ? match.dbEntry.id : match.id;
                        candidateName = match.name || '';
                    }

                    if (role === 'autoeq') {
                        const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
                        if (!baseCurve) {
                            showToast("Please load a Base IEM onto the graph first!", "⚠️");
                            return;
                        }

                        await this.loadSubSourceToGraph(curveIdToLoad, srcIdx, 'target');

                        PEQDB_Module.generateLeastSquaresAutoEQ();
                        App.switchTab('eq');
                        showToast(`🪄 AutoEQ solved: ${baseCurve.name} → ${candidateName}!`, "🪄");
                        return;
                    }

                    if (curveIdToLoad) {
                        this.loadSubSourceToGraph(curveIdToLoad, srcIdx, role);
                    }
                },

                getShortDriveLabel: function(driveObj) {
                    if (!driveObj) return '<div class="inline-flex items-center gap-1.5 whitespace-nowrap"><span class="text-zinc-500 font-bold">DRIVE:</span><span class="text-zinc-500 font-bold">N/A</span></div>';
                    if (driveObj.label.includes('Phone')) return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="Easy to drive: fine on any phone or laptop, no extra gear needed"><span class="text-zinc-500 font-bold">DRIVE:</span><img src="app/icons/phone.png" class="w-4 h-4 object-contain inline-block"><span class="text-emerald-400 font-black">Easy</span></div>`;
                    if (driveObj.label.includes('Dongle')) return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="Needs a dongle: a small ~$20 USB adapter gives louder, cleaner sound"><span class="text-zinc-500 font-bold">DRIVE:</span><img src="app/icons/dongle.png" class="w-4 h-4 object-contain inline-block"><span class="text-amber-400 font-black">Decent</span></div>`;
                    return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="Needs an amp: use a headphone amplifier for full volume and sound"><span class="text-zinc-500 font-bold">DRIVE:</span><img src="app/icons/desktop.png" class="w-4 h-4 object-contain inline-block"><span class="text-rose-400 font-black">Hard</span></div>`;
                },

                getShortEqLabel: function(eqObj) {
                    if (!eqObj || !eqObj.tooltip) return '<div class="inline-flex items-center gap-1.5 whitespace-nowrap"><span class="text-zinc-500 font-bold">EQ:</span><span class="text-zinc-500 font-bold">N/A</span></div>';
                    const tipText = eqObj.tooltip.replace(/"/g, '&quot;');
                    if (eqObj.badge.label.includes('Friendly')) return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="${tipText}"><span class="text-zinc-500 font-bold">EQ:</span><span class="inline-flex items-center justify-center text-sm leading-none">🟢</span><span class="text-emerald-400 font-black">Easy</span></div>`;
                    if (eqObj.badge.label.includes('Mod')) return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="${tipText}"><span class="text-zinc-500 font-bold">EQ:</span><span class="inline-flex items-center justify-center text-sm leading-none">🟡</span><span class="text-amber-400 font-black">Decent</span></div>`;
                    return `<div class="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer" data-tooltip="${tipText}"><span class="text-zinc-500 font-bold">EQ:</span><span class="inline-flex items-center justify-center text-sm leading-none">🔴</span><span class="text-rose-400 font-black">Hard</span></div>`;
                },

                rightTabModes: [
                    { id: 'taste', label: 'Taste', emoji: '❤️' },
                    { id: 'upgrade', label: 'Upgrade', emoji: '🚀' },
                    { id: 'giantkiller', label: 'Gem', emoji: '💎' },
                    { id: 'endgame', label: 'Endgame', emoji: '👑' }
                ],
                cycleRightTab: function(dir) {
                    const currentIdx = this.rightTabModes.findIndex(m => m.id === this.activeRightTab);
                    const total = this.rightTabModes.length;
                    const nextIdx = (currentIdx + dir + total) % total;
                    this.switchRightTab(this.rightTabModes[nextIdx].id);
                },
                switchRightTab: function(tabId) {
                    this.activeRightTab = tabId;
                    ['taste', 'upgrade', 'giantkiller', 'endgame'].forEach(id => {
                        const panel = document.getElementById('find-right-panel-' + id);
                        const btn = document.getElementById('find-right-tab-' + id);
                        if (panel) {
                            if (id === tabId) panel.classList.remove('hidden');
                            else panel.classList.add('hidden');
                        }
                        if (btn) {
                            if (id === tabId) {
                                btn.classList.add('active');
                                btn.setAttribute('aria-selected', 'true');
                            } else {
                                btn.classList.remove('active');
                                btn.setAttribute('aria-selected', 'false');
                            }
                        }
                    });

                    const stepperLabel = document.getElementById('find-right-tab-stepper-label');
                    if (stepperLabel) {
                        const info = this.rightTabModes.find(m => m.id === tabId) || this.rightTabModes[0];
                        stepperLabel.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">${info.emoji}</span> ${info.label}`;
                    }

                    if (tabId === 'upgrade' && !this.selectedUpgradeBaseIemId) {
                        const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
                        if (baseCurve) {
                            this.setUpgradeBaseIem(baseCurve.id, baseCurve.name);
                        }
                    }
                },

















                // Bounded LRU for per-card render data. This was a plain object
                // keyed by database id that was written on every card render and
                // NEVER cleared or capped, so simply browsing the Find results
                // grew it to one entry per catalogue row (~5,000) and held it for
                // the whole session — each entry retaining a 100-point
                // Float32Array plus an HTML string. (It did not go stale:
                // candInterp is built with an explicit 500 Hz / 75 dB and never
                // reads the alignment settings, so only unbounded growth was at
                // fault, not staleness.)
                _cardDataCache: null,
                _cardDataCacheKeys: [],
                CARD_CACHE_MAX: 400,
                _cardCacheGet: function(key) {
                    if (!this._cardDataCache || key == null) return undefined;
                    return this._cardDataCache[key];
                },
                _cardCacheSet: function(key, data) {
                    if (key == null) return data;
                    if (!this._cardDataCache) { this._cardDataCache = {}; this._cardDataCacheKeys = []; }
                    if (this._cardDataCache[key] === undefined) {
                        this._cardDataCacheKeys.push(key);
                        // Evict oldest-first. The list is insertion-ordered, so
                        // shifting off the front is the LRU approximation and
                        // costs nothing at this size.
                        while (this._cardDataCacheKeys.length > this.CARD_CACHE_MAX) {
                            const oldest = this._cardDataCacheKeys.shift();
                            delete this._cardDataCache[oldest];
                        }
                    }
                    this._cardDataCache[key] = data;
                    return data;
                },

                _getCachedCardData: function(item, dbEntry, freqs) {
                    const key = (dbEntry && dbEntry.id != null) ? dbEntry.id : (item.id != null ? item.id : null);
                    const hit = this._cardCacheGet(key);
                    if (hit !== undefined) return hit;

                    const candInterp = item.interp || (item.data ? CurveUtils.cubicSplineInterpolate(CurveUtils.normalizeTo75dB(item.data, 500, 75), freqs) : null);

                    const rawTags = dbEntry ? dbEntry.tags : (item.data ? PEQDB_Module.analyzeCurveSignature(item.data) : []);
                    const uniqueTags = [...new Set(rawTags || [])].slice(0, 4);
                    const tagsHtml = uniqueTags.map(t => {
                        const emoji = FindEngine.getTagEmoji(t);
                        return `<span class="find-tag-icon" data-tooltip="${esc(t)}">${emoji || '🏷️'}</span>`;
                    }).join('');

                    const genreMatch = FindEngine.determineIemGenreMatch ? FindEngine.determineIemGenreMatch(item, dbEntry) : { emoji: '🎧', name: 'Pop / Dance' };
                    const gameGenreMatch = FindEngine.determineIemGameGenreMatch ? FindEngine.determineIemGameGenreMatch(item, dbEntry) : { emoji: '🎮', name: 'All-Rounder / Gaming' };

                    const data = {
                        candInterp: candInterp,
                        uniqueTags: uniqueTags,
                        tagsHtml: tagsHtml,
                        genreMatch: genreMatch,
                        gameGenreMatch: gameGenreMatch
                    };
                    if (key != null) return this._cardCacheSet(key, data);
                    return data;
                },

                _drawCardSparkline: function(idx, item) {
                    const sparkCanvas = document.getElementById('spark-' + idx);
                    if (!sparkCanvas || !item.data) return;
                    const sw = sparkCanvas.clientWidth || 120;
                    const sh = sparkCanvas.clientHeight || 40;
                    sparkCanvas.width = sw;
                    sparkCanvas.height = sh;
                    const sctx = sparkCanvas.getContext('2d');
                    sctx.clearRect(0, 0, sw, sh);
                    sctx.fillStyle = '#000000';
                    sctx.fillRect(0, 0, sw, sh);
                    const savedThemeId = localStorage.getItem('settings_theme_id') || 'slate';
                    const themeConfig = App.themeMap[savedThemeId] || App.themeMap['slate'];
                    const sparkColor = themeConfig.accent || '#3b82f6';
                    const norm = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                    sctx.strokeStyle = sparkColor;
                    sctx.lineWidth = 2.2;
                    sctx.lineJoin = 'round';
                    sctx.beginPath();
                    for (let i = 0; i < norm.length; i++) {
                        const x = (Math.log10(norm[i][0] / 20) / Math.log10(20000 / 20)) * sw;
                        const y = sh - ((norm[i][1] - 60) / 30) * sh;
                        if (i === 0) sctx.moveTo(x, y);
                        else sctx.lineTo(x, y);
                    }
                    sctx.stroke();
                },

                renderMatches: function(matches) {
                    matches = this.applyGenreFilters(matches);
                    this._lastMatches = matches;

                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const colMatches = document.getElementById('find-col-results');
                    const countBar = document.getElementById('find-results-count');
                    const countText = document.getElementById('find-results-count-text');
                    if (colMatches) colMatches.style.display = 'flex';
                    if (!grid) return;

                    grid.innerHTML = '';
                    if (!matches || matches.length === 0) {
                        if (emptyState) emptyState.classList.remove('hidden');
                        if (countBar) countBar.classList.add('hidden');
                        return;
                    }
                    if (emptyState) emptyState.classList.add('hidden');
                    if (countBar) countBar.classList.remove('hidden');
                    if (countText) {
                        countText.textContent = `${matches.length} matches`;
                        countText.className = 'text-[9.5px] font-black uppercase tracking-wider text-emerald-400';
                    }

                    const isBlind = document.getElementById('find-blind-mode')?.checked;
                    const targetCurve = this.generateTargetCurve();
                    const freqs = CurveUtils.generateLogGrid(100);
                    const targetInterp = CurveUtils.normalizeTo75dB(targetCurve, 500, 75).map(pt => pt[1]);

                    const matchesToRender = matches;
                    const CHUNK_SIZE = 40;
                    let cursor = 0;
                    let INITIAL_WINDOW = 200;
                    let SCROLL_WINDOW = 100;
                    let renderCap = Math.min(INITIAL_WINDOW, matchesToRender.length);
                    let sentinel = null;
                    let observer = null;
                    let chainActive = false;

                    // Render epoch: resetFindResults / selector setters bump
                    // this._renderEpoch so an in-flight chunk chain (and its
                    // scroll observer callbacks) abort instead of repopulating
                    // the "cleared" grid or interleaving old cards into a new
                    // scan's results.
                    const renderEpoch = (this._renderEpoch = (this._renderEpoch || 0) + 1);
                    const isStale = () => this._renderEpoch !== renderEpoch;

                    const scheduleChunk = () => {
                        if (chainActive || isStale() || !matchesToRender.length) return;
                        chainActive = true;
                        setTimeout(() => { chainActive = false; if (!isStale()) renderChunk(); }, 16);
                    };

                    const refreshMarquee = () => {
                        if (!this._cardMarqueeEls) this._cardMarqueeEls = new WeakSet();
                        grid.querySelectorAll('.match-genre-name').forEach(el => {
                            if (!this._cardMarqueeEls.has(el)) { this._cardMarqueeEls.add(el); activateOrbitMarquee(el); }
                        });
                    };

                    const attachObserver = () => {
                        if (observer) return;
                        if (this._findObserver) { this._findObserver.disconnect(); this._findObserver = null; }
                        sentinel = document.createElement('div');
                        sentinel.className = 'find-sentinel';
                        sentinel.style.height = '2px';
                        grid.appendChild(sentinel);
                        observer = new IntersectionObserver((entries) => {
                            if (isStale()) { detachObserver(); return; }
                            if (entries.some(en => en.isIntersecting)) {
                                renderCap = Math.min(renderCap + SCROLL_WINDOW, matchesToRender.length);
                                if (cursor < renderCap) scheduleChunk();
                            }
                        }, { root: null, threshold: 0 });
                        observer.observe(sentinel);
                        this._findObserver = observer;
                    };

                    const detachObserver = () => {
                        if (observer) { observer.disconnect(); observer = null; }
                        if (sentinel && sentinel.parentNode) sentinel.parentNode.removeChild(sentinel);
                        sentinel = null;
                    };

                    const finalizeRender = () => {
                        detachObserver();
                        if (countText) countText.textContent = `${matchesToRender.length} matches`;
                        refreshMarquee();
                    };

                    let sparkJobs = [];
                    let sparkScheduled = false;
                    const scheduleSparkFlush = () => {
                        if (sparkScheduled) return;
                        sparkScheduled = true;
                        requestAnimationFrame(() => {
                            sparkScheduled = false;
                            const jobs = sparkJobs;
                            sparkJobs = [];
                            for (let j = 0; j < jobs.length; j++) {
                                try { this._drawCardSparkline(jobs[j].idx, jobs[j].item); } catch (err) {}
                            }
                        });
                    };

                    const renderChunk = () => {
                        if (isStale()) return;
                        const end = Math.min(cursor + CHUNK_SIZE, renderCap, matchesToRender.length);
                        const matchesFragment = document.createDocumentFragment();

                        for (let index = cursor; index < end; index++) {
                            const item = matchesToRender[index];
                        const card = document.createElement('div');
                        const idx = index + 1;
                        const matchPct = item.similarity || 0;

                        let dbEntry = item.dbEntry;
                        if (!dbEntry && this.iemDatabase && this.iemDatabase.length > 0) {
                            dbEntry = this.getDbEntry(item);
                        }
                        if (!dbEntry && PEQDB_Module.STATE.dataset) {
                            dbEntry = PEQDB_Module.STATE.dataset.find(d => d.id === item.id);
                        }

                        const rawFiles = (dbEntry && Array.isArray(dbEntry.files)) ? dbEntry.files : (item.files || []);
                        const fileCount = rawFiles.length;
                        const isMulti = fileCount > 1;

                        let cardStyle = "";
                        let rankEmoji = "🏆";
                        let rankText = `RANK #${idx}`;
                        let rankColorClass = "text-zinc-500";
                        let emojiStyle = "font-size: 18px; line-height: 1;";

                        if (idx === 1) {
                            cardStyle = `background: linear-gradient(135deg, rgba(251, 191, 36, 0.08) 0%, rgba(120, 53, 4, 0.03) 100%), var(--bg-card) !important; border: 2px solid var(--border-color) !important; box-shadow: 6px 6px 0px 0px var(--border-color) !important;`;
                            rankEmoji = "👑"; rankText = "1ST"; rankColorClass = "text-amber-400";
                            emojiStyle = "font-size: 32px; line-height: 1; filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.5));";
                        } else if (idx === 2) {
                            cardStyle = `background: linear-gradient(135deg, rgba(148, 163, 184, 0.08) 0%, rgba(30, 41, 59, 0.02) 100%), var(--bg-card) !important; border: 2px solid var(--border-color) !important; box-shadow: 5px 5px 0px 0px var(--border-color) !important;`;
                            rankEmoji = "🥈"; rankText = "2ND"; rankColorClass = "text-slate-300";
                            emojiStyle = "font-size: 28px; line-height: 1; filter: drop-shadow(0 0 4px rgba(148, 163, 184, 0.4));";
                        } else if (idx === 3) {
                            cardStyle = `background: linear-gradient(135deg, rgba(217, 119, 6, 0.06) 0%, rgba(120, 53, 4, 0.01) 100%), var(--bg-card) !important; border: 2px solid var(--border-color) !important; box-shadow: 4px 4px 0px 0px var(--border-color) !important;`;
                            rankEmoji = "🥉"; rankText = "3RD"; rankColorClass = "text-amber-600";
                            emojiStyle = "font-size: 28px; line-height: 1; filter: drop-shadow(0 0 4px rgba(217, 119, 6, 0.3));";
                        } else {
                            cardStyle = `background: var(--bg-card) !important; border: 2px solid var(--border-color) !important; box-shadow: 4px 4px 0px 0px var(--border-color) !important;`;
                        }

                        card.className = "section-card p-3 flex flex-col justify-between hover:scale-[1.015] hover:shadow-2xl transition-all duration-200 relative overflow-hidden group";
                        card.style.cssText = cardStyle;

                        let badgeText = "Explore";
                        let badgeColorClass = "text-rose-500";

                        if (item.isTuningMatch || typeof item.similarity === 'number') {
                            const similarity = item.similarity || 0;
                            if (similarity >= 95) { badgeColorClass = "text-emerald-400"; badgeText = `${similarity.toFixed(1)}%`; }
                            else if (similarity >= 88) { badgeColorClass = "text-emerald-400"; badgeText = `${similarity.toFixed(1)}%`; }
                            else if (similarity >= 80) { badgeColorClass = "text-amber-400"; badgeText = `${similarity.toFixed(1)}%`; }
                            else { badgeColorClass = "text-rose-500"; badgeText = `${similarity.toFixed(1)}%`; }
                        }

                        const cacheD = this._getCachedCardData(item, dbEntry, freqs);
                        const candInterp = cacheD.candInterp;
                        const eqFeat = candInterp ? this.calculateEQFeasibility(candInterp, targetInterp, freqs) : null;
                        const driveability = dbEntry ? this.getDriveabilityStatus(dbEntry.impedance, dbEntry.sensitivity) : null;

                        let rawName = dbEntry ? (dbEntry.variant ? `${dbEntry.brand} ${dbEntry.model} (${dbEntry.variant})` : `${dbEntry.brand} ${dbEntry.model}`) : item.name;

                        const price = dbEntry ? dbEntry.price_usd : null;
                        const driverType = dbEntry ? dbEntry.driver_type : null;
                        const driverConfig = dbEntry ? dbEntry.driver_config : null;
                        const connector = dbEntry ? dbEntry.connector : null;
                        const year = dbEntry ? dbEntry.year : null;
                        const formFactorRaw = dbEntry ? (dbEntry.form_factor || 'IEM') : 'IEM';

                        let finalName = rawName;
                        if (year && finalName.includes(`(${year})`)) {
                            finalName = finalName.replace(`(${year})`, '').trim();
                        }

                        const curveIdToLoad = dbEntry ? dbEntry.id : item.id;
                        const hasGraph = !!(item.data || fileCount > 0);

                        const uniqueTags = cacheD.uniqueTags;
                        const tagsHtml = cacheD.tagsHtml;

                        const driveHtml = this.getShortDriveLabel(driveability);
                        const eqHtml = this.getShortEqLabel(eqFeat);

                        const driverEmoji = FindEngine.driverEmojis[driverType] || '⚙️';
                        const driverTooltip = `${driverType || 'Driver'}${driverConfig ? ' (' + driverConfig + ')' : ''}`;
                        const connectorEmoji = FindEngine.connectorEmojis[connector] || '🔌';
                        const connectorTooltip = connector || 'Standard Connector';

                        const formFactorEmojiMap = {
                            'IEM': FindEngine.formFactorEmojis['IEM'],
                            'In-Ear Monitor': FindEngine.formFactorEmojis['IEM'],
                            'Earbuds (Wired)': FindEngine.formFactorEmojis['Earbuds (Wired)'],
                            'Wireless Earbuds (TWS)': FindEngine.formFactorEmojis['Wireless Earbuds (TWS)'],
                            'Over-Ear Headphones (Wired)': FindEngine.formFactorEmojis['Over-Ear Headphones (Wired)'],
                            'Wireless Over-Ear Headphones': FindEngine.formFactorEmojis['Wireless Over-Ear Headphones']
                        };
                        const formEmoji = formFactorEmojiMap[formFactorRaw] || FindEngine.formFactorEmojis['IEM'];
                        const formTooltip = formFactorRaw || 'In-Ear Monitor (IEM)';

                        // Escaped for attribute interpolation: brand/model/
                        // variant/tags/tooltips come from the user-replaceable
                        // database (see esc/escJs in app-core-shared.js).
                        // Declared AFTER every input above exists — placing
                        // this block earlier read formTooltip before its
                        // const declaration (TDZ ReferenceError).
                        const escFinalName = esc(finalName);
                        const escCurveId = esc(curveIdToLoad);
                        const escDriverTip = esc(driverTooltip);
                        const escConnectorTip = esc(connectorTooltip);
                        const escFormTip = esc(formTooltip);

                        if (!this.cardState[idx]) this.cardState[idx] = { srcIdx: 0, roleIdx: 0 };
                        const currentRoleOpt = this.cardRoleOptions[this.cardState[idx].roleIdx || 0];

                        const genreMatch = cacheD.genreMatch;
                        const gameGenreMatch = cacheD.gameGenreMatch;
                        const vibeHeaderLabel = "BEST MUSIC GENRE MATCH";

                        if (isBlind) {
                            card.innerHTML = `
                                <div class="space-y-2">
                                    <div class="flex justify-between items-center select-none pb-1">
                                        <div class="flex items-center gap-1.5 min-w-0 pr-1">
                                            <span style="${emojiStyle}" class="vibrant-emoji flex-shrink-0">${rankEmoji}</span>
                                            <span class="text-[9.5px] font-black uppercase tracking-wider ${rankColorClass}">${rankText}</span>
                                        </div>
                                        <span class="text-xs font-black ${badgeColorClass}">${badgeText}</span>
                                    </div>
                                    <div class="space-y-1">
                                        <h4 id="blind-title-${idx}" class="text-xs font-bold select-none" style="filter: blur(5px);">Reveal Required</h4>
                                        <div class="flex flex-wrap gap-1 mt-1.5">
                                            <span class="text-[8.5px] font-bold text-zinc-500">🔐 Profile Locked</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="flex gap-2 mt-3 pt-2.5 border-t-2 border-black">
                                    <button data-cmd="FindEngine.revealIEM" data-arg-0="@self" data-arg-1="${escJs(finalName)}" data-arg-2="blind-title-${idx}" class="flex-1 py-1.5 btn-clear text-[9px] font-black cursor-pointer">🔓 Reveal IEM</button>
                                </div>
                            `;
                        } else {
                            card.innerHTML = `
                                <div class="space-y-2">
                                    <div class="flex justify-between items-center select-none pb-1">
                                        <div class="flex items-center gap-1.5 min-w-0 pr-1">
                                            <span style="${emojiStyle}" class="vibrant-emoji flex-shrink-0">${rankEmoji}</span>
                                            <span class="text-[9.5px] font-black uppercase tracking-wider whitespace-nowrap ${rankColorClass}">${rankText}</span>
                                        </div>
                                        <span class="text-lg font-black ${badgeColorClass} flex-shrink-0">${badgeText}</span>
                                    </div>

                                    <div class="flex items-center gap-2 mt-1">
                                        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title="${vibeHeaderLabel}: ${genreMatch.name}">
                                            <div class="w-7 h-7 bg-[var(--bg-input)] border-2 border-black flex items-center justify-center flex-shrink-0 shadow-[1px_1px_0px_0px_#000]">
                                                <span class="emoji-font vibrant-emoji text-base leading-none">${genreMatch.emoji}</span>
                                            </div>
                                            <span class="match-genre-name text-[9px] font-black uppercase text-stone-200 inline-block whitespace-nowrap">${genreMatch.name}</span>
                                        </div>
                                        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title="Game Match: ${gameGenreMatch.name}">
                                            <div class="w-7 h-7 bg-[var(--bg-input)] border-2 border-black flex items-center justify-center flex-shrink-0 shadow-[1px_1px_0px_0px_#000]">
                                                <span class="emoji-font vibrant-emoji text-base leading-none">${gameGenreMatch.emoji}</span>
                                            </div>
                                            <span class="match-genre-name text-[9px] font-black uppercase text-stone-200 inline-block whitespace-nowrap">${gameGenreMatch.name}</span>
                                        </div>
                                    </div>

                                    <div class="space-y-1">
                                        <div class="flex items-start gap-2 w-full">
                                            <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0 mt-0.5" data-id="${escCurveId}" data-name="${escFinalName}" data-cmd="FindEngine.updateFloatingCompareBar">
                                            <div class="flex-1 w-full">
                                                <span class="text-xs font-black text-stone-200 leading-snug line-clamp-2">${escFinalName}</span>
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                            ${price !== null && price !== undefined ? `<span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>` : ''}
                                            ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                                            ${driverType ? `<span class="spec-icon-badge" data-tooltip="${escDriverTip}">${driverEmoji}</span>` : ''}
                                            ${connector ? `<span class="spec-icon-badge" data-tooltip="${escConnectorTip}">${connectorEmoji}</span>` : ''}
                                            <span class="spec-icon-badge" data-tooltip="${escFormTip}">${formEmoji}</span>
                                        </div>

                                        <div class="h-[42px] w-full border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
                                            <canvas id="spark-${idx}" class="absolute inset-0 w-full h-full block opacity-85"></canvas>
                                        </div>

                                        <div class="flex items-center justify-between w-full mt-2.5 px-1 text-[8.5px] font-mono select-none whitespace-nowrap">
                                            ${driveHtml}
                                            ${eqHtml}
                                        </div>

                                        <div class="flex items-center justify-center gap-3 w-full mt-2 pt-1">
                                            ${tagsHtml}
                                        </div>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5 mt-3 pt-2 border-t-2 border-black ${hasGraph ? '' : 'hidden'}">
                                    <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${idx}" data-arg-1="-1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                    <button data-cmd="FindEngine.loadCardToGraph" data-arg-0="${idx}" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none" >
                                        <span id="label-role-stepper-${idx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                    </button>
                                    <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${idx}" data-arg-1="1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
                                </div>
                            `;
                        }

                        matchesFragment.appendChild(card);

                        if (!isBlind && item.data && hasGraph) {
                            sparkJobs.push({ idx: idx, item: item });
                            scheduleSparkFlush();
                        }
                        }

                        // Insert BEFORE the sentinel so the sentinel stays pinned to
                        // the bottom of the list. Appending after it buried the
                        // sentinel mid-list, which forced back-and-forth scrolling
                        // (and skipped batches on fast scrolls) to load the next 100.
                        if (sentinel && sentinel.parentNode === grid) {
                            grid.insertBefore(matchesFragment, sentinel);
                        } else {
                            grid.appendChild(matchesFragment);
                        }

                        cursor = end;
                        if (countText) countText.textContent = `${Math.min(cursor, matchesToRender.length)} / ${matchesToRender.length}`;

                        if (cursor < renderCap && cursor < matchesToRender.length) {
                            scheduleChunk();
                        } else if (cursor < matchesToRender.length) {
                            attachObserver();
                            refreshMarquee();
                        } else {
                            finalizeRender();
                        }
                    };

                    if (matchesToRender.length > 0) {
                        scheduleChunk();
                    }
                },

                resetFindResults: function() {
                    this._lastMatches = null;
                    // Invalidate any pending chunked-render chain (see
                    // renderMatches): a scheduled chunk previously re-appended
                    // old cards into the cleared grid for up to renderCap items.
                    this._renderEpoch = (this._renderEpoch || 0) + 1;
                    if (this._findObserver) { this._findObserver.disconnect(); this._findObserver = null; }
                    const grid = document.getElementById('find-matches-grid');
                    if (grid) grid.innerHTML = '';
                    const countBar = document.getElementById('find-results-count');
                    if (countBar) countBar.classList.add('hidden');
                    const emptyState = document.getElementById('find-empty-state');
                    if (emptyState) emptyState.classList.remove('hidden');
                },


                revealIEM: function(btn, realName, titleId) {
                    const titleEl = document.getElementById(titleId);
                    if (titleEl) {
                        titleEl.textContent = realName;
                        // Undo the blur. The blur is an inline style now because
                        // Tailwind has no `blur-xs` step (its scale starts at
                        // `sm`), so the old class never compiled and the blind
                        // test's answer was fully legible before the reveal.
                        titleEl.classList.remove('select-none');
                        titleEl.style.filter = '';
                    }

                    const iem = PEQDB_Module.STATE.dataset.find(i => i.name === realName || this.sanitizeName(i.name) === realName);
                    if (iem && btn && btn.parentElement) {
                        const parent = btn.parentElement;

                        const sigs = PEQDB_Module.analyzeCurveSignature(iem.data);
                        const tagsHtml = sigs.map(t => {
                            return `<span class="text-[8px] font-black px-1.5 py-0.5 bg-white/[0.04] border border-white/[0.05] text-zinc-400 whitespace-nowrap">${t}</span>`;
                        }).join('');

                        const cardBody = parent.previousElementSibling;
                        if (cardBody) {
                            const tagSlot = cardBody.querySelector('div.flex.flex-wrap');
                            if (tagSlot) tagSlot.innerHTML = tagsHtml;
                        }

                        parent.innerHTML = `
                            <button data-cmd="FindEngine.loadToGraph" data-arg-0="${escJs(iem.id)}" data-arg-1="base" class="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-stone-200 font-black text-[9px] cursor-pointer">📈 Base</button>
                            <button data-cmd="FindEngine.loadToGraph" data-arg-0="${escJs(iem.id)}" data-arg-1="reference" class="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-stone-200 font-black text-[9px] cursor-pointer">🆚 Reference</button>
                        `;
                    }
                    showToast("IEM identity unlocked!", "🔓");
                },








                compareSelected: function() {
                    const checked = document.querySelectorAll('.find-compare-cb:checked');
                    if (checked.length < 2 || checked.length > 4) {
                        showToast("Check 2-4 IEMs to compare.", "⚠️");
                        return;
                    }
                    const toLoad = Array.from(checked).map(cb => ({
                        id: cb.getAttribute('data-id'),
                        name: cb.getAttribute('data-name')
                    }));
                    PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'reference');
                    toLoad.forEach((item, i) => {
                        const datasetItem = PEQDB_Module.STATE.dataset.find(d => d.id === item.id);
                        if (datasetItem && datasetItem.data) {
                            const uid = item.id + '-ref-' + Date.now() + i;
                            const color = PEQDB_Module.colorPalette[i % PEQDB_Module.colorPalette.length];
                            PEQDB_Module.STATE.activeCurves.push({
                                uid, id: item.id, name: item.name, data: datasetItem.data,
                                color, role: 'reference', visible: true, offset: 0
                            });
                        }
                    });
                    PEQDB_Module.updateAll();
                    App.switchTab('eq');
                    showToast(`Loaded ${toLoad.length} curves for comparison!`, "📊");
                },


                loadSubSourceToGraph: async function(itemId, fileIndex, role) {
                    PEQDB_Module.toggleCurveSelection(itemId, fileIndex);
                    const item = PEQDB_Module.STATE.dataset.find(i => i.id === itemId);
                    const curveUid = `${itemId}_src_${fileIndex}`;
                    if (item) {
                        PEQDB_Module.assignRole(curveUid, role);
                        App.switchTab('eq');
                        showToast(`Loaded ${item.name} (${role.toUpperCase()}) to Graph!`, "📈");
                    }
                },

                loadToGraph: async function(id, role) {
                    const item = PEQDB_Module.STATE.dataset.find(i => i.id === id);
                    if (!item) return;

                    if (!item.data || item.data.length < 2) {
                        const loader = document.getElementById('peqdb-loading');
                        if (loader) loader.style.display = 'flex';
                        const ok = await CurveIndexer.loadCurve(item, 0);
                        if (loader) loader.style.display = 'none';

                        if (!ok) {
                            showToast(`Failed to load curve data for ${item.name}`, "⚠️");
                            return;
                        }
                    }

                    const curveUid = `${item.id}_src_0`;
                    if (role === 'base') {
                        PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'base');
                    } else if (role === 'target') {
                        PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.role !== 'target');
                    }

                    PEQDB_Module.STATE.activeCurves = PEQDB_Module.STATE.activeCurves.filter(c => c.uid !== curveUid);

                    const colorIdx = PEQDB_Module.STATE.activeCurves.length % PEQDB_Module.colorPalette.length;
                    const finalColor = PEQDB_Module.colorPalette[colorIdx];

                    PEQDB_Module.STATE.activeCurves.push({
                        uid: curveUid,
                        id: item.id,
                        fileIndex: 0,
                        filePath: item.primaryFilePath,
                        name: item.name,
                        data: item.data,
                        color: finalColor,
                        role: role,
                        visible: true,
                        offset: 0
                    });

                    PEQDB_Module.updateAll();
                    App.switchTab('eq');
                    showToast(`Loaded "${item.name}" as ${role.toUpperCase()} plot!`, "📈");
                }
            };
Object.assign(FindEngine, Find_TasteMethods);
Object.assign(FindEngine, Find_EndgameMethods);
Object.assign(FindEngine, Find_UpgradeMethods);
Object.assign(FindEngine, Find_GenreMethods);

            const AppState = {
                get database() { return PEQDB_Module.STATE.dataset; },
                get activeCurves() { return PEQDB_Module.STATE.activeCurves; },
                get filters() { return FindEngine.filterTags; },
                get theme() { return App.themeMap[App.currentTheme] || null; },
                get charts() { return { radar: IEM_Module.radarChart || null }; },
                get audio() { return SharedAudio; }
            };
            window.AppState = AppState;
