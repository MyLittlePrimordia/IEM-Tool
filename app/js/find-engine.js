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

                _tagOptionList: function() {
                    const list = [{ val: 'any', label: '<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any Tag' }];
                    this.approvedTagsList.forEach(tag => {
                        list.push({ val: tag, label: `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">${this.tagEmojis[tag] || '🏷️'}</span> ${tag}` });
                    });
                    return list;
                },

                _genreOptionList: function(isMusic) {
                    const list = [{ val: 'any', label: `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">🎲</span> Any ${isMusic ? 'Music' : 'Gaming'}` }];
                    this.genreFamilies.forEach(f => {
                        const v = isMusic ? f.musicVariants[0] : f.gameVariants[0];
                        if (v) list.push({ val: v.name, label: `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">${v.emoji}</span> ${v.name}` });
                    });
                    return list;
                },

                cycleCustomOption: function(prefix, key, dir) {
                    let optionsList = [];
                    if (key === 'driver') optionsList = this.driverOptions;
                    else if (key === 'connector') optionsList = this.connectorOptions;
                    else if (key === 'formfactor') optionsList = (prefix === 'ug') ? this.ugFormFactorOptions : this.formFactorOptions;
                    else if (key === 'tag') optionsList = this._tagOptionList();
                    else if (key === 'musicgenre') optionsList = this._genreOptionList(true);
                    else if (key === 'gamegenre') optionsList = this._genreOptionList(false);

                    if (optionsList.length === 0) return;

                    const inputId = `${prefix}-filter-${key}`;
                    const input = document.getElementById(inputId);
                    const currentVal = input ? input.value : 'any';

                    let curIdx = optionsList.findIndex(o => o.val === currentVal);
                    if (curIdx === -1) curIdx = 0;

                    const total = optionsList.length;
                    const nextIdx = (curIdx + dir + total) % total;
                    const selected = optionsList[nextIdx];

                    this._selectCustomOptionPrefixed(prefix, key, selected.val, selected.label);
                },

                _selectCustomOptionPrefixed: function(prefix, key, value, htmlLabel) {
                    const input = document.getElementById(`${prefix}-filter-${key}`);
                    const label = document.getElementById(`label-${prefix}-filter-${key}`);
                    const menu = document.getElementById(`menu-${prefix}-filter-${key}`);
                    if (input) input.value = value;
                    if (label) label.innerHTML = htmlLabel;
                    if (menu) menu.classList.add('hidden');

                    // Once a tab has run, spec changes live-update the results instead
                    // of silently waiting for the user to re-press the button.
                    if (prefix === 'ug' && this._upgradeHasRun && this.selectedUpgradeBaseIemId) {
                        this.renderUpgradePathway();
                    } else if (prefix === 'gk' && this._gkHasRun && this.selectedGkFlagshipId) {
                        this.scanGiantKillers();
                    }
                },

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
                            html += `<button type="button" onclick="FindEngine.togglePick('${p.kind}','${p.value.replace(/'/g, "\\'")}')" data-tooltip="${p.value}" data-value="${p.value}" data-fx="${fx}" class="no-tactile find-pick-badge ${on ? 'on' : ''}${playing}" aria-pressed="${on}">
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

                removePick: function(kind, value) {
                    this.selectedPicks = (this.selectedPicks || []).filter(p => !(p.kind === kind && p.value === value));
                    this.updatePickUI();
                },

                clearPicks: function() {
                    this.selectedPicks = [];
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
                selectCustomOption: function(key, value, htmlLabel) {
                    this._selectCustomOptionPrefixed('find', key, value, htmlLabel);
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
                    if (!tagStr) return '🏷️';
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

                loadSavedTasteFavorites: function() {
                    try {
                        const saved = localStorage.getItem('find_taste_favorites');
                        if (saved) {
                            this.tasteFavorites = JSON.parse(saved);
                        }
                    } catch(e) {}
                    this.renderTasteChips();
                },

                saveTasteFavorites: function() {
                    try {
                        localStorage.setItem('find_taste_favorites', JSON.stringify(this.tasteFavorites));
                    } catch(e) {}
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

                calculateSubFileMatchScore: function(subData, targetInterp, freqs) {
                    return this.calculateCurveMatchScore(subData, targetInterp, freqs, true);
                },

                driverTechCanon: { DD: 'DD', DYNAMIC: 'DD', BA: 'BA', ARMATURE: 'BA', PLANAR: 'Planar', EST: 'EST', ELECTROSTATIC: 'EST', PZT: 'PZT', PIEZO: 'PZT', PIEZOELECTRIC: 'PZT', BC: 'BC', BONE: 'BC', MEMS: 'MEMS' },
                parseDriverConfig: function(configStr) {
                    if (!configStr) return [];
                    const found = [];
                    String(configStr).split(/[+,\/]/).forEach(token => {

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
                    if (Array.isArray(c)) return c.some(x => String(x).toLowerCase().trim() === t);
                    if (!c) return false;
                    return String(c).toLowerCase().includes(t);
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
                        const dbTagsLower = db.tags.map(t => String(t).toLowerCase());
                        const anyTag = metaPicks.some(p => {
                            const reqLower = String(p.value).toLowerCase();
                            return dbTagsLower.some(t => t.includes(reqLower) || reqLower.includes(t));
                        });
                        if (!anyTag) return false;
                    }

                    return true;
                },

                loadDatabase: async function() {
                    try {

                        if (window.CurveIndexer && Array.isArray(CurveIndexer.catalog) && CurveIndexer.catalog.length > 0) {
                            this.iemDatabase = CurveIndexer.catalog;
                        } else {
                            const res = await fetch('database.json');
                            if (res.ok) this.iemDatabase = await res.json();
                        }
                        this.populateCloneSelector();
                        this.populateBrandSuggestions();
                    } catch(e) {
                        console.warn("[FindEngine] Metadata database not found or offline. Filtering fallback in effect.", e);
                    }
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
                        if (tuningBtn) tuningBtn.classList.remove('active');
                        if (filtersBtn) filtersBtn.classList.add('active');
                        tuningControls.classList.add('hidden');
                        filterControls.classList.remove('hidden');
                        if (targetCurveBlock) targetCurveBlock.classList.add('hidden');
                        if (pickSection) pickSection.classList.remove('hidden');
                        this.fitPickGrid();
                    } else {
                        if (filtersBtn) filtersBtn.classList.remove('active');
                        if (tuningBtn) tuningBtn.classList.add('active');
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
                        (window.PEQDB_Module && PEQDB_Module.STATE && PEQDB_Module.STATE.dataset),
                        (window.CurveIndexer && CurveIndexer.catalog)
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
                        <div onmousedown="event.preventDefault(); FindEngine.selectBrandName('${escJs(b)}')" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800">
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

                getDbEntry: function(item) {
                    if (!this.iemDatabase || this.iemDatabase.length === 0) return null;

                    let match = this.iemDatabase.find(db => db.id === item.id);
                    if (match) return match;

                    match = this.iemDatabase.find(db => db.files && db.files.some(f => f.toLowerCase() === item.id.toLowerCase()));
                    return match;
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
                                PEQDB_Module.databaseFullyLoaded = true;
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

                cycleBaseline: function() {

                    this.clonedTargetInterp = null;
                    if (this.isClonedModeActive) {
                        this.deactivateEQBaseClone();
                    }

                    this.currentBaselineIndex = (this.currentBaselineIndex + 1) % this.baselineOptions.length;
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

                    setInterval(() => {
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
                                btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 rounded text-[9px] font-bold text-stone-300 flex items-center justify-center px-2 truncate shadow-inner";
                                row.classList.remove('hidden');
                            }
                        } else {
                            if (this.isClonedModeActive) {
                                this.deactivateEQBaseClone();
                            }
                            btn.textContent = "🔒 EQ Base Slot Empty";
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 rounded text-[9px] font-black uppercase text-zinc-555 flex items-center justify-center gap-1.5 shadow-inner cursor-not-allowed";
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
                        btn.className = "w-full h-7 bg-gradient-to-r from-emerald-600 to-teal-600 border border-emerald-500/40 rounded text-[9px] font-black uppercase text-white flex items-center justify-center px-2 truncate shadow-md active-btn";
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
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 rounded text-[9px] font-bold text-stone-300 flex items-center justify-center px-2 truncate shadow-inner";
                        } else {
                            btn.textContent = "🔒 EQ Base Slot Empty";
                            btn.className = "w-full h-7 bg-zinc-950/40 border border-zinc-900/60 rounded text-[9px] font-black uppercase text-zinc-555 flex items-center justify-center gap-1.5 shadow-inner cursor-not-allowed";
                        }
                    }
                    this.drawTargetVisualization();
                },

                handleTasteAccordionToggle: function() {
                    const details = document.getElementById('find-taste-details');
                    if (details && details.open) {

                        this.populateCloneSelector();
                    }
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

                saveCanonicalProfilesToCache: function() {
                    try {
                        localStorage.setItem('find_canonical_profiles', JSON.stringify(this.canonicalCache));
                    } catch (e) {
                        console.warn("Failed to save canonical profiles cache.", e);
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
                        if (!item.data) return;

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
                    if (this.iemDatabase && this.iemDatabase.length) {
                        dbMap = new Map();
                        this.iemDatabase.forEach(db => { if (db && db.id) dbMap.set(db.id, db); });
                    }
                    const resolveDb = (item) => {
                        if (!dbMap || !item || !item.id) return null;
                        let db = dbMap.get(item.id);
                        if (!db) {
                            // Same fallback getDbEntry uses: match by file path.
                            const idLower = String(item.id).toLowerCase();
                            db = this.iemDatabase.find(d => d.files && d.files.some(f => f.toLowerCase() === idLower)) || null;
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
                    let slim = null; // built lazily — only when the payload must cross the boundary
                    const buildSlim = () => {
                        if (!slim) slim = this._buildWorkerSlim(items);
                        return slim;
                    };
                    return new Promise((resolve) => {
                        let retriedWithItems = false;
                        const onMsg = (e) => {
                            const d = e.data || {};
                            if (d.type !== 'result') return;
                            // Worker lost its memoized set (fresh/restarted
                            // worker): resend the full payload once instead of
                            // falling back to the slow main-thread scan.
                            if (!d.ok && d.reprime && !retriedWithItems) {
                                retriedWithItems = true;
                                try {
                                    worker.postMessage({ type: 'tuning', items: buildSlim(), targetInterp: targetInterp, freqs: freqs, sig: sig });
                                    this._workerCanonicalSig = sig;
                                } catch (postErr) {
                                    worker.removeEventListener('message', onMsg);
                                    worker.removeEventListener('error', onErr);
                                    resolve(null);
                                }
                                return;
                            }
                            // Only consume replies that carry tuning matches: the
                            // endgame/upgrade scans share this worker and their
                            // result shapes differ (no `matches` field).
                            if (d.matches === undefined) return;
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            if (this._scanToken !== token) return resolve(null);
                            if (!d.ok) { console.warn("[FindEngine] worker tuning failed:", d.error); return resolve(null); }
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
                            resolve(list);
                        };
                        const onErr = (e) => {
                            console.warn("[FindEngine] worker error:", e && e.message);
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            resolve(null);
                        };
                        worker.addEventListener('message', onMsg);
                        worker.addEventListener('error', onErr);
                        try {
                            if (workerHasSet) {
                                // Same item set the worker already memoized:
                                // send only the target + signature.
                                worker.postMessage({ type: 'tuning', targetInterp: targetInterp, freqs: freqs, sig: sig });
                            } else {
                                worker.postMessage({ type: 'tuning', items: buildSlim(), targetInterp: targetInterp, freqs: freqs, sig: sig });
                                this._workerCanonicalSig = sig;
                            }
                        } catch (e) {
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            resolve(null);
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

                updateIndexingProgressBar: function() {
                    const progressContainer = document.getElementById('find-progress-container');
                    if (PEQDB_Module.databaseFullyLoaded) {
                        if (progressContainer) progressContainer.classList.add('hidden');
                        return;
                    }

                    const dataset = PEQDB_Module.STATE.dataset;
                    if (!dataset || dataset.length === 0) return;

                    const indexedCount = dataset.filter(item => item.data !== null).length;
                    const totalCount = dataset.length;
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
                        if (status) status.textContent = `⚡ Indexing: ${indexedCount}/${totalCount} files cached...`;
                    }
                },

                populateCloneSelector: function() {

                },

                scanAndMatch: async function() {
                    if (this.isScanning) return;
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

getDriveabilityStatus: function(impedance, sensitivity) {
                    if (!impedance || !sensitivity) return null;
                    const imp = parseFloat(impedance);
                    const sens = parseFloat(sensitivity);
                    if (isNaN(imp) || isNaN(sens)) return null;

                    const vReq = Math.sqrt((Math.pow(10, (115 - sens) / 10) * imp) / 1000);

                    if (vReq <= 0.45) return { label: '📱 Phone OK', color: 'text-emerald-400' };
                    if (vReq <= 1.5) return { label: '🔌 Dongle Rec', color: 'text-amber-400' };
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
                selectedGkFlagshipId: null,
                selectedGkFlagshipName: '',
                selectedGkFlagshipPrice: 500,

                updateGkBudgetDisplay: function(val) {
                    const disp = document.getElementById('find-gk-budget-val');
                    if (disp) disp.textContent = `$${val} Max`;
                },

                rerunGiantKillersIfLive: function() {
                    if (this._gkHasRun && this.selectedGkFlagshipId) {
                        this.scanGiantKillers();
                    }
                },

                updateEndgameBudgetDisplay: function(val) {
                    const disp = document.getElementById('find-endgame-budget-val');
                    if (disp) disp.textContent = `$${val} Max`;
                },

                // Main-thread mirror of the worker's scoreEndgameCategories
                // (find-worker.js). Used only when the Worker is unavailable.
                _scoreEndgameCategoriesLocal: function(cc, freqs, maxPrice) {
                    const EG = window.EndgameCategories;
                    if (!EG) return null;
                    const cats = EG.ENDGAME_CATEGORIES || [];
                    const maxPicks = EG.ENDGAME_MAX_PICKS || 12;
                    const priced = cc.filter(e => e.price && e.price <= maxPrice);
                    const out = {};
                    const champions = [];

                    cats.forEach(cat => {
                        const scored = priced.map(e => {
                            const res = EG.scoreCategory(cat, e.tags, e.interp, freqs);
                            const bonus = Math.min(5, (e.price / maxPrice) * 5);
                            return { entry: e, composite: res.score + bonus, reason: res.reason, tagMatch: res.tagMatch, curveScore: res.curveScore };
                        }).sort((a, b) => b.composite - a.composite);
                        if (!scored.length) { out[cat.id] = { pool: [] }; return; }

                        const champion = scored[0];
                        const gkCeiling = champion.entry.price * EG.GIANT_KILLER_PRICE_FRACTION;
                        const gkSims = {};
                        for (let i = 1; i < scored.length; i++) {
                            const s = scored[i];
                            if (s.entry.price > gkCeiling) continue;
                            const sim = this._scoreInterp(s.entry.interp, champion.entry.interp, freqs, true);
                            if (sim >= 75) gkSims[s.entry.id] = { sim: sim, s: s };
                        }

                        const pool = [];
                        const limit = Math.min(maxPicks, scored.length);
                        for (let i = 0; i < limit; i++) {
                            const s = scored[i];
                            const gk = gkSims[s.entry.id];
                            const pick = {
                                id: s.entry.id, name: s.entry.name, price: s.entry.price,
                                brand: s.entry.brand || '', score: Math.min(100, Math.round(s.composite)),
                                reason: s.reason, tagMatch: !!s.tagMatch, curveScore: Math.round(s.curveScore || 0)
                            };
                            if (i === 0) pick.isChampion = true;
                            if (gk) { pick.isGiantKiller = true; pick.similarity = gk.sim; pick.reason = `${gk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`; }
                            pool.push(pick);
                        }

                        let bestGkAll = null, bestGk = null;
                        for (const gkId in gkSims) {
                            const g = gkSims[gkId];
                            if (!bestGkAll || g.sim > bestGkAll.sim) bestGkAll = g;
                            if (pool.some(p => p.id === gkId)) continue;
                            if (!bestGk || g.sim > bestGk.sim) bestGk = g;
                        }
                        if (bestGk) {
                            pool.push({
                                id: bestGk.s.entry.id, name: bestGk.s.entry.name, price: bestGk.s.entry.price,
                                brand: bestGk.s.entry.brand || '', score: Math.min(100, Math.round(bestGk.s.composite)),
                                reason: `${bestGk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`,
                                tagMatch: !!bestGk.s.tagMatch, curveScore: Math.round(bestGk.s.curveScore || 0),
                                isGiantKiller: true, similarity: bestGk.sim
                            });
                        }

                        champions.push({ id: champion.entry.id, name: champion.entry.name, price: champion.entry.price, gk: bestGkAll });
                        out[cat.id] = { pool: pool };
                    });

                    const valueById = new Map();
                    champions.forEach(ch => {
                        const gk = ch.gk;
                        if (!gk) return;
                        const e = gk.s.entry;
                        const existing = valueById.get(e.id);
                        if (existing && existing.similarity >= gk.sim) return;
                        valueById.set(e.id, { id: e.id, name: e.name, price: e.price, brand: e.brand || '', similarity: gk.sim, matchName: ch.name });
                    });
                    out._value = { pool: Array.from(valueById.values()).sort((a, b) => b.similarity - a.similarity).slice(0, 12) };
                    return out;
                },

                _runEndgameViaWorker: function(items, maxPrice, freqs) {
                    const worker = this.ensureFindWorker();
                    if (!worker) return Promise.resolve(null);
                    // Same canonical-list handshake as tuning: the endgame scan
                    // reuses the worker's memoized profiles when the item set
                    // is unchanged (sig matches itemsKey() in find-worker.js).
                    const sig = this._workerSetSig(items);
                    const workerHasSet = (sig === this._workerCanonicalSig);
                    return new Promise((resolve) => {
                        let retriedWithItems = false;
                        const onMsg = (e) => {
                            const d = e.data || {};
                            if (d.type !== 'result') return;
                            // Worker lost its memoized set: resend full payload once.
                            if (!d.ok && d.reprime && !retriedWithItems) {
                                retriedWithItems = true;
                                try {
                                    worker.postMessage({ type: 'endgame', items: items, maxPrice: maxPrice, freqs: freqs, sig: sig });
                                    this._workerCanonicalSig = sig;
                                } catch (postErr) {
                                    cleanup();
                                    resolve(null);
                                }
                                return;
                            }
                            // Only consume replies that belong to THIS request type:
                            // tuning/upgrade listeners share the same worker.
                            if (d.endgame === undefined) return;
                            cleanup();
                            if (!d.ok) { console.warn("[FindEngine] worker endgame failed:", d.error); return resolve(null); }
                            resolve(d.endgame);
                        };
                        const onErr = (e) => {
                            console.warn("[FindEngine] worker error:", e && e.message);
                            cleanup();
                            resolve(null);
                        };
                        const cleanup = () => {
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                        };
                        worker.addEventListener('message', onMsg);
                        worker.addEventListener('error', onErr);
                        try {
                            if (workerHasSet) {
                                worker.postMessage({ type: 'endgame', maxPrice: maxPrice, freqs: freqs, sig: sig });
                            } else {
                                worker.postMessage({ type: 'endgame', items: items, maxPrice: maxPrice, freqs: freqs, sig: sig });
                                this._workerCanonicalSig = sig;
                            }
                        } catch (e) {
                            cleanup();
                            resolve(null);
                        }
                    });
                },

                scanEndgameSets: async function() {
                    if (this.isScanning) return;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');
                    try {
                        this.isScanning = true;
                        if (grid) grid.innerHTML = '';
                        if (emptyState) emptyState.classList.add('hidden');
                        if (overlay) overlay.classList.remove('hidden');

                        const title = document.getElementById('find-scanning-title');
                        const subtitle = document.getElementById('find-scanning-subtitle');
                        if (title) title.textContent = "Forging Endgame Sets...";
                        if (subtitle) subtitle.textContent = "Scoring champions, gems, and category contenders...";

                        const dataset = PEQDB_Module.STATE.dataset || [];
                        if (!dataset.length) {
                            showToast("Measurement database not loaded yet.", "⚠️");
                            return;
                        }

                        // Batched curve loading (same pattern as scanAndMatch).
                        const batchSize = 25;
                        for (let i = 0; i < dataset.length; i += batchSize) {
                            const chunk = dataset.slice(i, i + batchSize).filter(item => !item.data || item.data.length < 2);
                            if (chunk.length > 0) {
                                await Promise.all(chunk.map(item => CurveIndexer.loadCurve(item, 0)));
                            }
                        }
                        const valid = dataset.filter(item => item.data && item.data.length >= 2);

                        const maxPrice = parseFloat(document.getElementById('find-endgame-budget-slider')?.value || 500);
                        const freqs = CurveUtils.generateLogGrid(100);

                        // Shared enriched payload (price/brand/tags included) so
                        // the worker's canonical cache is identical whether it
                        // was built by the tuning or the endgame scan.
                        const slim = this._buildWorkerSlim(valid);

                        let endgame = await this._runEndgameViaWorker(slim, maxPrice, freqs);
                        if (!endgame) {
                            const cc = slim.filter(s => s.data).map(s => {
                                const norm = CurveUtils.normalizeTo75dB(s.data, 500, 75);
                                return {
                                    id: s.id, name: s.name,
                                    interp: CurveUtils.cubicSplineInterpolate(norm, freqs),
                                    price: s.price, brand: s.brand, tags: s.tags
                                };
                            });
                            endgame = this._scoreEndgameCategoriesLocal(cc, freqs, maxPrice);
                        }

                        if (!endgame) {
                            showToast("Endgame engine unavailable.", "⚠️");
                            return;
                        }

                        this._lastEndgame = endgame;
                        this._endgameState = {};
                        this.renderEndgameResults(endgame);
                        showToast("Endgame sets ready!", "👑");
                    } catch (err) {
                        console.error("[FindEngine] endgame scan failed:", err);
                        showToast("Endgame scan failed.", "⚠️");
                    } finally {
                        if (overlay) overlay.classList.add('hidden');
                        this.isScanning = false;
                    }
                },

                cycleEndgamePick: function(catId, dir) {
                    if (!this._lastEndgame || !this._lastEndgame[catId]) return;
                    const st = this._endgameState = this._endgameState || {};
                    const pool = this._lastEndgame[catId].pool || [];
                    if (!pool.length) return;
                    const cur = st[catId] || 0;
                    st[catId] = (cur + dir + pool.length) % pool.length;
                    this.renderEndgameResults(this._lastEndgame);
                },

                cycleEndgameValue: function(dir) {
                    if (!this._lastEndgame || !this._lastEndgame._value) return;
                    const st = this._endgameState = this._endgameState || {};
                    const pool = this._lastEndgame._value.pool || [];
                    if (!pool.length) return;
                    const cur = st._value || 0;
                    st._value = (cur + dir + pool.length) % pool.length;
                    this.renderEndgameResults(this._lastEndgame);
                },

                renderEndgameResults: function(endgame) {
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    if (!grid) return;
                    if (emptyState) emptyState.classList.add('hidden');

                    const EG = window.EndgameCategories;
                    const st = this._endgameState = this._endgameState || {};

                    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const freqs = CurveUtils.generateLogGrid(100);

                    let cardsHtml = '';
                    const sparkJobs = [];
                    const marqueesToActivate = [];

                    const buildCardHtml = (cardIdx, headerTitle, headerEmoji, scorePct, scoreColor, curOption, totalOptions, item, catId, isValueStrip, valueMatchName, pReason, badgeHtml, trustHtml) => {
                        if (!this.cardState[cardIdx]) this.cardState[cardIdx] = { srcIdx: 0, roleIdx: 0 };
                        const currentRoleOpt = this.cardRoleOptions[this.cardState[cardIdx].roleIdx];

                        const dbEntry = this.getDbEntry(item);
                        const finalName = item.name || (dbEntry ? dbEntry.name : 'Unknown IEM');
                        const price = (dbEntry && dbEntry.price_usd != null) ? dbEntry.price_usd : (item.price_usd != null ? item.price_usd : null);
                        const year = dbEntry && dbEntry.year ? dbEntry.year : null;

                        const driverType = dbEntry ? dbEntry.driver_type : (item.driver_type || null);
                        const driverTooltip = driverType ? `Driver: ${driverType}` : 'Driver: Dynamic (DD)';
                        const driverEmoji = (this.driverEmojis && this.driverEmojis[driverType]) || '⚙️';

                        const connector = dbEntry ? dbEntry.connector : (item.connector || null);
                        const connectorTooltip = connector ? `Connector: ${connector}` : 'Connector: 2-Pin (0.78mm)';
                        const connectorEmoji = (this.connectorEmojis && this.connectorEmojis[connector]) || '🔌';

                        const formFactor = dbEntry ? (dbEntry.form_factor || 'IEM') : (item.form_factor || 'IEM');
                        const formTooltip = `Form: ${formFactor}`;
                        const formEmoji = (typeof formFactorEmojiMap !== 'undefined' && formFactorEmojiMap[formFactor]) || (this.formFactorEmojis && this.formFactorEmojis[formFactor]) || (this.formFactorEmojis && this.formFactorEmojis['IEM']) || '🎧';

                        const cached = this._getCachedCardData(item, dbEntry, freqs);
                        const genreMatch = cached.genreMatch;
                        const gameGenreMatch = cached.gameGenreMatch;
                        const tagsHtml = cached.tagsHtml;

                        let driveHtml = '<span class="text-zinc-500 font-bold">⚡ Easy to drive</span>';
                        if (dbEntry && dbEntry.impedance_ohm && dbEntry.sensitivity_db) {
                            const imp = parseFloat(dbEntry.impedance_ohm);
                            const sens = parseFloat(dbEntry.sensitivity_db);
                            if (imp >= 64 || sens < 98) {
                                driveHtml = '<span class="text-amber-400 font-bold" title="Higher impedance / lower sensitivity - benefits from an amp">⚡ Amp Req.</span>';
                            } else {
                                driveHtml = '<span class="text-emerald-400 font-bold">⚡ Easy to Drive</span>';
                            }
                        }

                        const curveIdToLoad = item.id || (dbEntry ? dbEntry.id : finalName);
                        const hasGraph = !!(item.data && item.data.length >= 2);
                        const sparkId = `spark-${cardIdx}`;
                        const marqId = `marquee-${cardIdx}`;

                        return `
                            <div id="card-${cardIdx}" class="section-card p-3 flex flex-col justify-between hover:scale-[1.015] hover:shadow-2xl transition-all duration-200 relative overflow-hidden group">
                                <div class="space-y-2">
                                    <div class="flex justify-between items-center select-none pb-1 border-b border-white/[0.06]">
                                        <div class="flex items-center gap-1.5 min-w-0 pr-1 truncate">
                                            <span class="vibrant-emoji flex-shrink-0 text-sm leading-none">${headerEmoji}</span>
                                            <span class="text-[10px] font-black uppercase tracking-wider whitespace-nowrap ${isValueStrip ? 'text-amber-300' : 'text-sky-400'} truncate">${esc(headerTitle)}</span>
                                        </div>
                                        <div class="flex items-center gap-1.5 flex-shrink-0">
                                            ${badgeHtml || ''}
                                            <span class="text-base font-black ${scoreColor} font-mono">${scorePct}%</span>
                                        </div>
                                    </div>

                                    <div class="flex justify-between items-center text-xs select-none">
                                        <span class="text-[9px] font-mono text-zinc-400 font-bold uppercase tracking-wider">Option ${curOption} of ${totalOptions}</span>
                                        ${totalOptions > 1 ? `
                                            <div class="flex items-center gap-1">
                                                <button onclick="FindEngine.${isValueStrip ? 'cycleEndgameValue(-1)' : `cycleEndgamePick('${catId}', -1)`}" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Previous option">◄</button>
                                                <button onclick="FindEngine.${isValueStrip ? 'cycleEndgameValue(1)' : `cycleEndgamePick('${catId}', 1)`}" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Next option">►</button>
                                            </div>
                                        ` : ''}
                                    </div>

                                    <div class="flex items-center gap-2 mt-1">
                                        <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title="Music Match: ${genreMatch.name}">
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
                                        <div class="flex items-center gap-2 w-full mt-1">
                                            <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0" data-id="${esc(curveIdToLoad)}" data-name="${esc(finalName)}" onclick="event.stopPropagation(); FindEngine.updateFloatingCompareBar();">
                                            <div class="flex-1 overflow-hidden relative flex items-center h-5">
                                                <span id="${marqId}" class="text-xs font-black text-stone-200 inline-block whitespace-nowrap">${esc(finalName)}</span>
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                            ${price !== null && price !== undefined ? `<span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>` : ''}
                                            ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                                            ${driverType ? `<span class="spec-icon-badge" data-tooltip="${driverTooltip}">${driverEmoji}</span>` : ''}
                                            ${connector ? `<span class="spec-icon-badge" data-tooltip="${connectorTooltip}">${connectorEmoji}</span>` : ''}
                                            <span class="spec-icon-badge" data-tooltip="${formTooltip}">${formEmoji}</span>
                                        </div>

                                        <div class="h-[42px] w-full rounded-none border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
                                            <canvas id="${sparkId}" class="absolute inset-0 w-full h-full block opacity-85"></canvas>
                                        </div>

                                        <div class="flex items-center justify-between w-full mt-2.5 px-1 text-[8.5px] font-mono select-none">
                                            <div class="flex-shrink-0">${driveHtml}</div>
                                            <div class="flex items-center justify-end overflow-hidden ml-1">
                                                ${trustHtml || ''}
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-center gap-3 w-full mt-2 pt-1">
                                            ${tagsHtml}
                                        </div>
                                    </div>
                                </div>

                                <div class="flex items-center gap-1.5 mt-3 pt-2 border-t-2 border-black ${hasGraph ? '' : 'hidden'}">
                                    <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole('${cardIdx}', -1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                    <button onclick="event.stopPropagation(); FindEngine.loadCardToGraph('${cardIdx}', '${esc(curveIdToLoad)}')" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none">
                                        <span id="label-role-stepper-${cardIdx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                    </button>
                                    <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole('${cardIdx}', 1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
                                </div>
                            </div>
                        `;
                    };

                    // 1. Value Strip Card
                    const vpool = (endgame._value && endgame._value.pool) || [];
                    if (vpool.length) {
                        const vi = (st._value || 0) % vpool.length;
                        const v = vpool[vi];
                        const dsItem = dataset.find(i => i.id === v.id) || { id: v.id, name: v.name, data: v.data };
                        const badgeHtml = '';
                        const trustHtml = `<span class="text-[9px] font-bold text-emerald-400 whitespace-nowrap truncate" title="Clone of ${esc(v.matchName)}">💥 ${esc(v.matchName)}</span>`;

                        cardsHtml += buildCardHtml('eg_val', 'Value', '💎', v.similarity.toFixed(1), 'text-amber-300', vi + 1, vpool.length, dsItem, '_value', true, v.matchName, '', badgeHtml, trustHtml);
                        sparkJobs.push({ cardIdx: 'eg_val', item: dsItem });
                        marqueesToActivate.push('marquee-eg_val');
                    }

                    // 2. Category Cards
                    (EG && EG.ENDGAME_CATEGORIES || []).forEach(cat => {
                        const entry = endgame[cat.id];
                        const pool = (entry && entry.pool) || [];
                        if (!pool.length) return;
                        const idx = (st[cat.id] || 0) % pool.length;
                        const p = pool[idx];
                        const dsItem = dataset.find(i => i.id === p.id) || { id: p.id, name: p.name, data: p.data };

                        const badgeHtml = p.isChampion
                            ? '<span class="text-[9.5px] font-black text-amber-300 whitespace-nowrap">👑 Champion</span>'
                            : (p.isGiantKiller ? '<span class="text-[9.5px] font-black text-emerald-400 whitespace-nowrap">💥 Gem</span>' : '');
                        const trustHtml = p.tagMatch
                            ? (p.curveScore >= 40 ? '<span class="text-[9px] font-bold text-emerald-400 whitespace-nowrap">✅ Confirmed</span>' : '<span class="text-[9px] font-bold text-rose-400 whitespace-nowrap">⚠️ Tag Conflict</span>')
                            : '<span class="text-[9px] font-bold text-sky-400 whitespace-nowrap">🔬 Measured</span>';

                        const headerEmoji = cat.emoji || (p.isChampion ? '👑' : '🎧');
                        const cardKey = `eg_${cat.id}`;

                        cardsHtml += buildCardHtml(cardKey, cat.label || cat.id, headerEmoji, Math.round(p.score), 'text-emerald-400', idx + 1, pool.length, dsItem, cat.id, false, '', p.reason, badgeHtml, trustHtml);
                        sparkJobs.push({ cardIdx: cardKey, item: dsItem });
                        marqueesToActivate.push(`marquee-${cardKey}`);
                    });

                    grid.innerHTML = cardsHtml || '<div class="col-span-full text-center text-zinc-400 italic text-xs py-8">No endgame candidates under budget. Try increasing your budget ceiling.</div>';

                    App.setFindSection('matches');

                    setTimeout(() => {
                        sparkJobs.forEach(job => {
                            if (job.item && job.item.data) {
                                const sparkCanvas = document.getElementById('spark-' + job.cardIdx);
                                if (sparkCanvas) {
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
                                    const norm = CurveUtils.normalizeTo75dB(job.item.data, 500, 75);
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
                        });

                        marqueesToActivate.forEach(id => {
                            const marq = document.getElementById(id);
                            if (marq) activateOrbitMarquee(marq);
                        });
                    }, 100);
                },

                // index.html's oninput calls *Debounced wrappers that were
                // never defined anywhere -- every keystroke in these three
                // search boxes threw and the live-filtering never ran
                // (only onfocus, which calls the un-debounced handler
                // directly, worked). Wrapping the existing live handlers
                // is enough; they were already correct.
                handleGkSearchDebounced: debounce(function(query) { FindEngine.handleGkSearch(query); }, 160),
                handleTasteSearchDebounced: debounce(function(query) { FindEngine.handleTasteSearch(query); }, 160),
                handleUpgradeSearchDebounced: debounce(function(query) { FindEngine.handleUpgradeSearch(query); }, 160),

                handleGkSearch: function(query) {
                    const container = document.getElementById('find-gk-search-results');
                    if (!container) return;
                    const hasQuery = !!(query && query.trim());                    container.classList.remove('hidden');

                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const matches = dataset.filter(item => {
                        const db = this.getDbEntry(item);
                        const price = db && db.price_usd ? parseFloat(db.price_usd) : (item.price_usd ? parseFloat(item.price_usd) : 0);
                        if (!hasQuery) {
                            const isFlagTag = Array.isArray(item.tags) && item.tags.some(t => String(t).toLowerCase() === 'flagship');
                            return isFlagTag || price >= 1000;
                        }
                        const searchableText = `${item.name} ${item.brand || ''} ${item.model || ''}`;
                        return PEQDB_Module.matchSearchTokens(searchableText, query);
                    }).sort((a, b) => {
                        return (a.name || '').localeCompare(b.name || '');
                    });

                    const scrollEl = document.getElementById('find-gk-scroll');
                    if (!scrollEl) return;
                    if (matches.length === 0) {
                        scrollEl.innerHTML = '<div class="p-1 text-zinc-500 italic text-xs">No matching flagship found.</div>';
                        return;
                    }

                    scrollEl.innerHTML = matches.map(item => {
                        const db = this.getDbEntry(item);
                        const p = db && db.price_usd ? db.price_usd : (item.price_usd || '200+');
                        return `
                            <div data-letter="${alphaKeyOf(item)}" onclick="FindEngine.setGkFlagship('${escJs(item.id)}', '${escJs(item.name)}', ${p})" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800 flex justify-between">
                                <span>${esc(item.name)}</span>
                                <span class="text-amber-400 font-mono ml-2">$${p}</span>
                            </div>
                        `;
                    }).join('');
                },

                setGkFlagship: function(id, name, price) {
                    this.selectedGkFlagshipId = id;
                    this.selectedGkFlagshipName = name;
                    this.selectedGkFlagshipPrice = parseFloat(price) || 500;
                    this._gkHasRun = false;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');
                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.remove('hidden');
                    if (overlay) overlay.classList.add('hidden');

                    const searchInput = document.getElementById('find-gk-search');
                    const searchResults = document.getElementById('find-gk-search-results');
                    const slot = document.getElementById('find-gk-flagship-slot');

                    if (searchInput) searchInput.value = '';
                    if (searchResults) searchResults.classList.add('hidden');

                    if (slot) {
                        slot.className = "w-full h-9 bg-[var(--bg-card)] border-2 border-[var(--border-color)] px-2.5 py-1 flex items-center justify-between gap-2 select-none relative shadow-[2px_2px_0px_0px_var(--border-color)]";
                        slot.innerHTML = `
                            <div class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                <span class="emoji-font vibrant-emoji text-sm flex-shrink-0 leading-none">👑</span>
                                <span class="text-xs font-black text-[var(--text-main)] truncate">${name} ($${this.selectedGkFlagshipPrice})</span>
                            </div>
                            <button type="button" onclick="FindEngine.clearGkFlagship()" class="w-5 h-5 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Change the flagship target">✕</button>
                        `;
                    }
                },

                clearGkFlagship: function() {
                    this.selectedGkFlagshipId = null;
                    this.selectedGkFlagshipName = '';
                    this._gkHasRun = false;
                    const slot = document.getElementById('find-gk-flagship-slot');
                    if (slot) {
                        slot.className = "w-full h-9 border-2 border-dashed border-black bg-black/10 flex items-center justify-center select-none";
                        slot.innerHTML = `<span class="text-[9px] font-black text-stone-400 uppercase tracking-wider">+ Select Flagship Target</span>`;
                    }
                },

                scanGiantKillers: async function() {
                    if (this.isScanning) return;
                    this._gkHasRun = true;
                    if (!this.selectedGkFlagshipId) {
                        showToast("Select a flagship IEM target in Step 1 first!", "⚠️");
                        return;
                    }

                    this.isScanning = true;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');

                    try {
                        if (grid) grid.innerHTML = '';
                        if (emptyState) emptyState.classList.add('hidden');
                        if (overlay) overlay.classList.remove('hidden');

                        const title = document.getElementById('find-scanning-title');
                        const subtitle = document.getElementById('find-scanning-subtitle');
                        if (title) title.textContent = "Hunting Gems...";
                        if (subtitle) subtitle.textContent = `Finding budget clones of ${this.selectedGkFlagshipName}...`;

                        const dataset = PEQDB_Module.STATE.dataset || [];
                        let flagshipItem = dataset.find(i => i.id === this.selectedGkFlagshipId);
                        if (!flagshipItem && this.iemDatabase) {
                            const dbMatch = this.iemDatabase.find(d => d.id === this.selectedGkFlagshipId);
                            if (dbMatch) flagshipItem = dbMatch;
                        }

                        if (!flagshipItem) {
                            showToast("Flagship curve data not found.", "⚠️");
                            return;
                        }

                        if (!flagshipItem.data || flagshipItem.data.length < 2) {
                            await CurveIndexer.loadCurve(flagshipItem, 0);
                        }

                        const freqs = CurveUtils.generateLogGrid(100);
                        const flagNorm = CurveUtils.normalizeTo75dB(flagshipItem.data, 500, 75);
                        const targetInterp = CurveUtils.cubicSplineInterpolate(flagNorm, freqs);

                        const budgetLimit = parseFloat(document.getElementById('find-gk-budget-slider')?.value || 50);
                        const selectedDrivers = this._getSpecSelection('gk', 'driver');
                        const selectedFormFactors = this._getSpecSelection('gk', 'formfactor');
                        const selectedConnectors = this._getSpecSelection('gk', 'connector');

                        // Cheap metadata filters first, then ONE batched loading
                        // pass — awaiting loadCurve inside the scoring loop made
                        // a cold-cache run thousands of serial HTTP round-trips.
                        const candidates = [];
                        for (let i = 0; i < dataset.length; i++) {
                            const item = dataset[i];
                            if (item.id === flagshipItem.id) continue;

                            const dbEntry = this.getDbEntry(item);
                            const price = dbEntry && dbEntry.price_usd ? parseFloat(dbEntry.price_usd) : (item.price_usd ? parseFloat(item.price_usd) : null);

                            if (!price || price > budgetLimit) continue;

                        if (selectedDrivers.length && !selectedDrivers.some(v => this.driverFilterMatches(dbEntry, v))) continue;

                        if (selectedFormFactors.length) {
                            if (!selectedFormFactors.some(v => this._formFactorMatches(dbEntry, v))) continue;
                        }

                        if (selectedConnectors.length) {
                            if (!selectedConnectors.some(v => this._connectorMatches(dbEntry, v))) continue;
                        }

                            candidates.push(item);
                        }

                        const batchSize = 25;
                        for (let i = 0; i < candidates.length; i += batchSize) {
                            const chunk = candidates.slice(i, i + batchSize).filter(item => !item.data || item.data.length < 2);
                            if (chunk.length > 0) {
                                await Promise.all(chunk.map(item => CurveIndexer.loadCurve(item, 0)));
                            }
                        }

                        const matches = [];
                        for (const item of candidates) {
                            if (!item.data || item.data.length < 2) continue;

                            const itemNorm = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const itemInterp = CurveUtils.cubicSplineInterpolate(itemNorm, freqs);

                            const matchPct = this._scoreInterp(itemInterp, targetInterp, freqs, true);

                            if (matchPct >= 75) {
                                const dbEntry = this.getDbEntry(item);
                                const price = dbEntry && dbEntry.price_usd ? parseFloat(dbEntry.price_usd) : (item.price_usd ? parseFloat(item.price_usd) : null);
                                matches.push({
                                    name: item.name,
                                    id: item.id,
                                    data: item.data,
                                    similarity: matchPct,
                                    interp: itemInterp,
                                    isGiantKiller: true,
                                    flagshipName: this.selectedGkFlagshipName,
                                    flagshipPrice: this.selectedGkFlagshipPrice,
                                    price: price,
                                    savings: Math.max(0, Math.round(this.selectedGkFlagshipPrice - price))
                                });
                            }
                        }

                        matches.sort((a, b) => b.similarity - a.similarity);

                        this._lastMatches = matches;
                        this.renderMatches(this._lastMatches);

                        App.setFindSection('matches');
                        showToast(`Found ${matches.length} Gems under $${budgetLimit}!`, "💎");
                    } catch (err) {
                        console.error("[FindEngine] Giant-Killer scan failed:", err);
                        this._handleScanError(err);
                    } finally {
                        if (overlay) overlay.classList.add('hidden');
                        this.isScanning = false;
                    }
                },

                selectedUpgradeBaseIemId: null,
                selectedUpgradeGoal: 'detail',
                cardState: {},


        // These 16 families are NOT hand-guessed — they're the actual clusters
        // found by running k-means on 7,575 real measured curves from this
        // catalog (reduced to the same 5-axis [subBoost, warmth, vocal,
        // treble, air] shape used everywhere else). Each cluster's `profile`
        // is its real centroid. Each family carries exactly one canonical
        // music label and one canonical gaming label, so the match-card
        // badges, the live EQ-tab overlay, and the Find-tab genre filters all
        // read off the same single set of names.
        genreFamilies: [
            { profile: [11.8, 8.4, 7.6, 8.6, -3.9], // "Basshead" (e.g. Blon BL03)
                musicVariants: [ { emoji: '🎤', name: 'Hip-Hop' } ],
                gameVariants: [ { emoji: '🧟', name: 'Zombie' } ] },

            { profile: [13.4, 11.1, 12.6, 11.7, 1.5], // "Boosted everywhere" max-fun V (KZ Vader)
                musicVariants: [ { emoji: '🔊', name: 'EDM' } ],
                gameVariants: [ { emoji: '🏎️', name: 'Racing' } ] },

            { profile: [11.1, 8.6, 8.4, 0.2, -9.9], // Bass+warmth, dark/flat treble (UE500)
                musicVariants: [ { emoji: '🌴', name: 'Reggae' } ],
                gameVariants: [ { emoji: '🧭', name: 'Adventure' } ] },

            { profile: [8.0, 6.0, 11.7, 9.8, -0.8], // Big vocal+treble peak (RaptGo Hook X)
                musicVariants: [ { emoji: '💃', name: 'Pop' } ],
                gameVariants: [ { emoji: '⚔️', name: 'RPG' } ] },

            { profile: [-18.9, -3.3, 15.9, 10.9, -1.1], // Thin bass, huge vocal spike (EarPods)
                musicVariants: [ { emoji: '🪩', name: 'Disco' } ],
                gameVariants: [ { emoji: '🏹', name: 'Roguelike' } ] },

            { profile: [7.8, 5.8, 9.1, 8.3, -10.4], // Bright, V-shaped, dark air (Tripowin Olina)
                musicVariants: [ { emoji: '🌀', name: 'Techno' } ],
                gameVariants: [ { emoji: '🚀', name: 'Sci-Fi' } ] },

            { profile: [-12.9, -2.4, 7.1, 0.2, -8.9], // Lean bass, DJ/monitor style (Sennheiser HD25)
                musicVariants: [ { emoji: '🛸', name: 'Synthwave' } ],
                gameVariants: [ { emoji: '🎯', name: 'Tactical' } ] },

            { profile: [8.1, 5.8, 7.6, 7.2, 1.7], // Bright, detailed — largest cluster (Simgot EA1000)
                musicVariants: [ { emoji: '🎸', name: 'Rock' } ],
                gameVariants: [ { emoji: '🧨', name: 'Action' } ] },

            { profile: [5.7, 5.0, 2.6, 5.1, -7.8], // Premium/reference, moderate (Sony IER-Z1R)
                musicVariants: [ { emoji: '🎷', name: 'Jazz' } ],
                gameVariants: [ { emoji: '🕹️', name: 'MMO' } ] },

            { profile: [-1.1, 1.3, 8.8, 6.1, -4.4], // Flat bass, bright/analytical (HiFiMan Ananda)
                musicVariants: [ { emoji: '🌍', name: 'World' } ],
                gameVariants: [ { emoji: '🏀', name: 'Sports' } ] },

            { profile: [-1.4, 0.9, 3.7, -1.5, -7.5], // Near-neutral, slightly dark, audiophile (Shure SE530)
                musicVariants: [ { emoji: '🎻', name: 'Classical' } ],
                gameVariants: [ { emoji: '♟️', name: 'Strategy' } ] },

            { profile: [4.7, 4.7, 2.7, -6.4, -15.4], // Warm/dark consumer, air cut (Beats Solo2)
                musicVariants: [ { emoji: '🪕', name: 'Folk' } ],
                gameVariants: [ { emoji: '🌱', name: 'Cozy' } ] },

            { profile: [-6.8, -1.6, -4.2, -10.3, -20.1], // Dark, rolled-off air (Beyerdynamic T50p)
                musicVariants: [ { emoji: '📻', name: 'Indie' } ],
                gameVariants: [ { emoji: '👻', name: 'Horror' } ] },

            { profile: [2.2, 2.7, 5.1, 2.5, -18.5], // Mild bass, huge air cut (Beats Studio)
                musicVariants: [ { emoji: '🌙', name: 'Lo-Fi' } ],
                gameVariants: [ { emoji: '🧩', name: 'Puzzle' } ] },

            { profile: [-32.4, -15.4, 6.7, -1.4, -13.3], // Near-bassless open-ear/bone-conduction
                musicVariants: [ { emoji: '🫧', name: 'ASMR' } ],
                gameVariants: [ { emoji: '👾', name: 'Arcade' } ] },

            { profile: [6.9, 4.6, 7.7, 2.8, -3.7], // "Typical" balanced Harman-ish — most common shape
                musicVariants: [ { emoji: '🎬', name: 'Cinematic' } ],
                gameVariants: [ { emoji: '🔫', name: 'FPS' } ] }
        ],

        // Independent GAMING-side classifier. Music and gaming live in
        // DIFFERENT psychoacoustic spaces: music genres are about tonal
        // balance/presence, while gaming genres are about competitive cues
        // (footstep clarity = upper-mids + treble, rumble = sub-bass, etc.).
        // Previously the game badge was hard-paired 1:1 to the music family
        // (a curve matched ONE family whose gameVariants it inherited), so
        // ASMR always paired with Arcade, Techno with Sci-Fi, etc. — the game
        // badge carried zero independent information. These profiles use a
        // gaming-tuned axis weighting (see nearestGameGenreFamilyIndex) and
        // are validated against all 4904 real database curves so every gaming
        // genre is reachable and combos vary (Rock->Adventure, Folk->Cozy,
        // Reggae->Zombie, etc.). Index order matches the gameVariants order in
        // genreFamilies so presetGenreMap's `g` indices stay valid.
        gameGenreFamilies: [
            { profile: [11.0, 7.0, 7.0, 0.0, -8.0], gameVariants: [ { emoji: '🧟', name: 'Zombie' } ] },
            { profile: [14.0, 10.0, 0.0, -4.0, -6.0], gameVariants: [ { emoji: '🏎️', name: 'Racing' } ] },
            { profile: [6.0, 3.0, 6.0, 6.0, 2.0], gameVariants: [ { emoji: '🧭', name: 'Adventure' } ] },
            { profile: [10.0, 3.0, 5.0, 6.0, 2.0], gameVariants: [ { emoji: '⚔️', name: 'RPG' } ] },
            { profile: [1.0, 3.0, 11.0, 7.0, -2.0], gameVariants: [ { emoji: '🏹', name: 'Roguelike' } ] },
            { profile: [12.0, 1.0, -3.0, 12.0, 4.0], gameVariants: [ { emoji: '🚀', name: 'Sci-Fi' } ] },
            { profile: [-1.0, 1.0, 8.0, 8.0, -1.0], gameVariants: [ { emoji: '🎯', name: 'Tactical' } ] },
            { profile: [8.0, 4.0, 8.0, 9.0, -1.0], gameVariants: [ { emoji: '🧨', name: 'Action' } ] },
            { profile: [3.0, 5.0, 6.0, 4.0, -4.0], gameVariants: [ { emoji: '🕹️', name: 'MMO' } ] },
            { profile: [4.0, 1.0, 5.0, 9.0, 2.0], gameVariants: [ { emoji: '🏀', name: 'Sports' } ] },
            { profile: [-1.0, 1.0, 5.0, 6.0, -1.0], gameVariants: [ { emoji: '♟️', name: 'Strategy' } ] },
            { profile: [3.0, 6.0, 3.0, -3.0, -9.0], gameVariants: [ { emoji: '🌱', name: 'Cozy' } ] },
            { profile: [5.0, 1.0, 2.0, -9.0, -12.0], gameVariants: [ { emoji: '👻', name: 'Horror' } ] },
            { profile: [1.0, 3.0, 7.0, 4.0, -5.0], gameVariants: [ { emoji: '🧩', name: 'Puzzle' } ] },
            { profile: [3.0, 2.0, 8.0, 8.0, -2.0], gameVariants: [ { emoji: '👾', name: 'Arcade' } ] },
            { profile: [-2.0, 0.0, 10.0, 10.0, 3.0], gameVariants: [ { emoji: '🔫', name: 'FPS' } ] }
        ],

        // Indexed 1:1 with genreFamilies, for the live EQ-tab badge's pulse
        // color/animation (Find/Upgrade cards don't need these, only the
        // single live badge does).
        genreFamilyStyles: [
            { colorClass: 'genre-color-basshead',   animClass: 'anim-match-punch' },
            { colorClass: 'genre-color-electronic', animClass: 'anim-match-pulse' },
            { colorClass: 'genre-color-soul',       animClass: 'anim-match-breath' },
            { colorClass: 'genre-color-pop',        animClass: 'anim-match-bounce' },
            { colorClass: 'genre-color-vocal',      animClass: 'anim-match-snap' },
            { colorClass: 'genre-color-electronic', animClass: 'anim-match-spin' },
            { colorClass: 'genre-color-indie',      animClass: 'anim-match-shake' },
            { colorClass: 'genre-color-rock',       animClass: 'anim-match-rock' },
            { colorClass: 'genre-color-jazz',       animClass: 'anim-match-tilt' },
            { colorClass: 'genre-color-blues',      animClass: 'anim-match-float' },
            { colorClass: 'genre-color-classical',  animClass: 'anim-match-float' },
            { colorClass: 'genre-color-jazz',       animClass: 'anim-match-breath' },
            { colorClass: 'genre-color-metal',      animClass: 'anim-match-breath' },
            { colorClass: 'genre-color-blues',      animClass: 'anim-match-spin' },
            { colorClass: 'genre-color-vocal',      animClass: 'anim-match-float' },
            { colorClass: 'genre-color-pop',        animClass: 'anim-match-breath' }
        ],

        // Shared helper: interpolate a raw curve onto 6 reference points and
        // return the dB-deltas-from-mids vector [subBoost, warmth, vocalPresence,
        // trebleBoost, airExt] that the family profiles above are scored against.
        getCurveDeltas: function(curveData) {
            if (!curveData || curveData.length < 5) return null;
            const freqs = [30, 100, 500, 2500, 8000, 14000];
            const norm = CurveUtils.normalizeTo75dB(curveData, 500, 75);
            const interp = CurveUtils.cubicSplineInterpolate(norm, freqs);
            const [sb, mb, m, v, tr, air] = interp;
            return [sb - m, mb - m, v - m, tr - m, air - m];
        },

        // Same 5-axis reduction, but for the EQ tab's live 10-band parametric
        // EQ (fixed centers 31/62/125/250/500/1000/2000/4000/8000/16000 Hz)
        // instead of a measured curve, so both features share one classifier.
        // bandDeltas is the 10 boost/cut values in dB, band-index order.
        getEqBandDeltas: function(bandDeltas) {
            if (!bandDeltas || bandDeltas.length < 10) return null;
            const [b31, b62, b125, b250, b500, b1k, b2k, b4k, b8k, b16k] = bandDeltas;
            const sub = (b31 + b62) / 2;
            const warmth = (b125 + b250) / 2;
            const vocal = b1k;
            const treble = (b2k + b4k) / 2;
            const air = (b8k + b16k) / 2;
            return [sub, warmth, vocal, treble, air];
        },

        // Stable (non-random) string hash so the same IEM always lands on the
        // same variant label across reloads/re-renders, while different IEMs
        // in the same family spread across the full label list.
        hashStringToIndex: function(str, mod) {
            let h = 0;
            for (let i = 0; i < str.length; i++) {
                h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
            }
            return Math.abs(h) % mod;
        },

        nearestGenreFamilyIndex: function(deltas) {
            // Direction-based (weighted cosine) matching instead of Euclidean
            // nearest-centroid. Euclidean distance is biased toward whichever
            // centroid sits geometrically closest to the center of the 16-family
            // cluster, which collapsed every moderate V/bass shape onto one
            // "middle" family (Jazz/MMO). Cosine ignores overall magnitude, so
            // a big pure-bass boost maps to the bass-dominant family (Hip-Hop),
            // a V-shaped boost maps to the V-shaped family (EDM/Racing), etc.
            //
            // Per-axis weights for the 5-axis [sub, warmth, vocal, treble, air]
            // deltas. Perception-wise, genre primarily lives in the mid/vocal
            // bands, while sub-bass and air are the noisiest in measurement and
            // the least diagnostic — so we under-weight them and emphasize
            // vocal presence & treble so classification is more musical.
            const AXIS_W = [0.7, 1.0, 1.3, 1.1, 0.6];
            const W = AXIS_W.map(w => Math.sqrt(w));

            // Magnitude gate: an essentially-flat/quiet shape carries no genre
            // information, so route it to the near-neutral family (Classical)
            // instead of letting noise pick an arbitrary direction.
            let mag = 0;
            for (let j = 0; j < deltas.length; j++) mag += deltas[j] * W[j] * deltas[j] * W[j];
            if (mag < 0.25) return 10;

            let bestIdx = 0;
            let bestSim = -Infinity;
            this.genreFamilies.forEach((f, i) => {
                let dot = 0, qm = 0, pm = 0;
                for (let j = 0; j < deltas.length; j++) {
                    const q = deltas[j] * W[j];
                    const p = f.profile[j] * W[j];
                    dot += q * p;
                    qm += q * q;
                    pm += p * p;
                }
                const sim = dot / (Math.sqrt(qm) * Math.sqrt(pm));
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = i;
                }
            });
            return bestIdx;
        },

        nearestGenreFamily: function(deltas) {
            return this.genreFamilies[this.nearestGenreFamilyIndex(deltas)];
        },

        nearestGameGenreFamilyIndex: function(deltas) {
            // Gaming-tuned axis weights for [sub, warm, vocal, treble, air].
            // Emphasize sub-bass (rumble) and treble (footsteps/ammo clicks),
            // de-emphasize warmth (mud masking) and air (measurement noise).
            const AXIS_W = [1.2, 0.7, 1.3, 1.5, 0.5];
            const W = AXIS_W.map(w => Math.sqrt(w));

            let mag = 0;
            for (let j = 0; j < deltas.length; j++) mag += deltas[j] * W[j] * deltas[j] * W[j];
            if (mag < 0.25) return 10; // near-flat -> Strategy

            let bestIdx = 0;
            let bestSim = -Infinity;
            this.gameGenreFamilies.forEach((f, i) => {
                let dot = 0, qm = 0, pm = 0;
                for (let j = 0; j < deltas.length; j++) {
                    const q = deltas[j] * W[j];
                    const p = f.profile[j] * W[j];
                    dot += q * p;
                    qm += q * q;
                    pm += p * p;
                }
                const sim = dot / (Math.sqrt(qm) * Math.sqrt(pm));
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = i;
                }
            });
            return bestIdx;
        },

        nearestGameGenreFamily: function(deltas) {
            return this.gameGenreFamilies[this.nearestGameGenreFamilyIndex(deltas)];
        },

        pickGenreVariant: function(variants, seedId) {
            if (variants.length === 1) return variants[0];
            const idx = this.hashStringToIndex(String(seedId || 'default'), variants.length);
            return variants[idx];
        },

        _getCachedDeltas: function(item, dbEntry) {
            // Deltas are pure wrt the curve data (normalizeTo75dB at fixed
            // 500Hz/75dB), so cache them on the entry. A single scan can hit
            // each entry several times (badge + filter), and computing the
            // spline-based deltas twice per item (music + game) was pure waste.
            const target = dbEntry || item;
            if (target && target._genreDeltas) return target._genreDeltas;
            const curveData = item ? item.data : (dbEntry ? dbEntry.data : null);
            const deltas = this.getCurveDeltas(curveData);
            if (target) {
                try { target._genreDeltas = deltas; } catch (e) {}
            }
            return deltas;
        },

determineIemGenreMatch: function(item, dbEntry) {
       const deltas = this._getCachedDeltas(item, dbEntry);
       const seedId = (dbEntry && dbEntry.id) || (item && (item.id || item.name)) || 'default';
       if (deltas) {
           const family = this.nearestGenreFamily(deltas);
           return this.pickGenreVariant(family.musicVariants, seedId);
       }

       return { emoji: '💃', name: 'Pop' };
   },

determineIemGameGenreMatch: function(item, dbEntry) {
       const deltas = this._getCachedDeltas(item, dbEntry);
       const seedId = (dbEntry && dbEntry.id) || (item && (item.id || item.name)) || 'default';
       if (deltas) {
           const family = this.nearestGameGenreFamily(deltas);
           return this.pickGenreVariant(family.gameVariants, seedId);
       }

       return { emoji: '🎮', name: 'Video Game OST' };
   },

// Preset-declared genres. When the user applies a curated EQ preset, the genre
// overlay shows the preset's INTENDED genre instead of the shape the curve
// happens to match (a moderate preset curve rarely resembles the extreme family
// centroid it was named after). Only genres that map cleanly are declared here;
// everything else falls back to direction-based shape matching. Values are
// family indexes into genreFamilies (m = music side, g = gaming side).
presetGenreMap: {
    // Music
    balanced: null, flat: null, purist: null,
    warm: { m: 11, g: 11 }, vshape: { m: 1, g: 1 },
    harman: { m: 0, g: 0 }, hiphop: { m: 0, g: 0 },
    edm: { m: 1, g: 1 }, party: { m: 3, g: 3 },
    rock: { m: 7, g: 7 }, metal: { m: 7, g: 7 },
    jazz: { m: 8, g: 8 }, relaxed: { m: 8, g: 8 },
    classical: { m: 10, g: 10 }, orchestra: { m: 10, g: 10 },
    acoustic: { m: 11, g: 11 },
    rnb: { m: 0, g: 0 }, pop: { m: 3, g: 3 }, kpop: { m: 3, g: 3 },
    lofi: { m: 13, g: 13 }, reggae: { m: 2, g: 2 },
    funk: { m: 4, g: 4 }, disco: { m: 4, g: 4 },
    synthwave: { m: 6, g: 6 }, indie: { m: 12, g: 12 },
    // Gaming
    fps: { g: 15 }, competitive: { g: 15 }, footsteps: { g: 15 },
    sniper: { g: 15 }, gaming_imaging: { g: 6 }, precision: { g: 6 },
    tactical: { g: 6 }, stealth: { g: 6 }, cyberpunk: { g: 5 },
    storymode: { g: 3 }, rpg: { g: 3 }, survival: { g: 3 }, moba: { g: 10 },
    racing: { g: 1 }, arena: { g: 7 }, fighting: { g: 7 },
    sims: { g: 11 }, rhythm: { g: 14 }, casualgaming: { g: 14 },
    flight: { g: 5 }, sports: { g: 9 },
    horror: { m: 12, g: 12 }, action: { m: 7, g: 7 },
    // Media / cinematic
    cinema: { m: 15 }, movie: { m: 15 }, theater: { m: 10 },
    asmr: { m: 14, g: 14 }
},

declaredPresetGenre: function(presetKey, side) {
    if (!presetKey) return null;
    const entry = this.presetGenreMap[presetKey];
    if (!entry) return null;
    const idx = side === 'game' ? entry.g : entry.m;
    if (idx == null) return null;
    const family = this.genreFamilies[idx];
    const style = this.genreFamilyStyles[idx] || null;
    const v = side === 'game' ? family.gameVariants[0] : family.musicVariants[0];
    return {
        emoji: v.emoji,
        name: v.name,
        colorClass: style ? style.colorClass : null,
        animClass: style ? style.animClass : null
    };
},

// Live EQ-tab version: same 16 families, but returns ONE stable representative
// label per family (variants[0]) instead of hashing, since there's no per-id
// to anchor on here and hashing live slider state would make the badge flicker
// between synonyms (e.g. Trap vs Drill) on tiny slider moves with no audible reason.
// If a curated preset is active, its declared genre wins over the raw shape.
determineLiveMusicGenreMatch: function(bandDeltas, presetKey) {
    const declared = this.declaredPresetGenre(presetKey, 'm');
    if (declared) {
        const fallbackStyle = { colorClass: 'genre-color-pop', animClass: 'anim-match-breath' };
        return {
            emoji: declared.emoji,
            name: declared.name,
            colorClass: declared.colorClass || fallbackStyle.colorClass,
            animClass: declared.animClass || fallbackStyle.animClass
        };
    }

    const deltas = this.getEqBandDeltas(bandDeltas);
    const fallbackStyle = { colorClass: 'genre-color-pop', animClass: 'anim-match-breath' };
    if (!deltas) return { emoji: '💃', name: 'Pop', ...fallbackStyle };
    const idx = this.nearestGenreFamilyIndex(deltas);
    const family = this.genreFamilies[idx];
    const style = this.genreFamilyStyles[idx] || fallbackStyle;
    const v = family.musicVariants[0];
    return { emoji: v.emoji, name: v.name, colorClass: style.colorClass, animClass: style.animClass };
},

determineLiveGameGenreMatch: function(bandDeltas, presetKey) {
    const declared = this.declaredPresetGenre(presetKey, 'game');
    if (declared) {
        const fallbackStyle = { colorClass: 'genre-color-electronic', animClass: 'anim-match-breath' };
        return {
            emoji: declared.emoji,
            name: declared.name,
            colorClass: declared.colorClass || fallbackStyle.colorClass,
            animClass: declared.animClass || fallbackStyle.animClass
        };
    }

    const deltas = this.getEqBandDeltas(bandDeltas);
    const fallbackStyle = { colorClass: 'genre-color-electronic', animClass: 'anim-match-breath' };
    if (!deltas) return { emoji: '🎮', name: 'Video Game OST', ...fallbackStyle };
    // Classify against the GAMING centroids (gameGenreFamilies) — the old call
    // scored the shape against MUSIC profiles and then indexed into
    // genreFamilies for a label, so the live game badge disagreed with
    // determineIemGameGenreMatch (which correctly uses nearestGameGenreFamily).
    // Index order is aligned between both tables, so genreFamilyStyles stays valid.
    const idx = this.nearestGameGenreFamilyIndex(deltas);
    const family = this.gameGenreFamilies[idx];
    const style = this.genreFamilyStyles[idx] || fallbackStyle;
    const v = family.gameVariants[0];
    return { emoji: v.emoji, name: v.name, colorClass: style.colorClass, animClass: style.animClass };
},

applyGenreFilters: function(matches) {
    const picks = this.selectedPicks || [];
    const list = matches || [];
    if (!picks.length) return list;
    const kept = list.filter(m => {
        const dbEntry = m.dbEntry || this.getDbEntry(m);
        const count = this.countPickMatches(m, dbEntry, picks);
        m.pickCount = count;
        return count > 0;
    });
    kept.sort((a, b) => (b.pickCount || 0) - (a.pickCount || 0));
    return kept;
},

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

                cycleTuningPreset: function(dir) {
                    const total = this.tuningPresets.length;
                    this.currentTuningPresetIdx = (this.currentTuningPresetIdx + dir + total) % total;
                    const p = this.tuningPresets[this.currentTuningPresetIdx];

                    Object.entries(p.values).forEach(([key, val]) => {
                        const id = `find-${key}`;
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = val;
                            this.updateSliderUI(id);
                        }
                    });

                    const btn = document.getElementById('find-preset-cycle-btn');
                    const labelSpaceIdx = p.label.indexOf(' ');
                    const labelEmoji = p.label.slice(0, labelSpaceIdx);
                    const labelText = p.label.slice(labelSpaceIdx + 1);
                    if (btn) btn.innerHTML = `<span class="emoji-font vibrant-emoji text-xl w-6 h-6 inline-flex items-center justify-center leading-none mr-1.5 anim-toggle-pop">${labelEmoji}</span> ${labelText}`;

                    this.drawTargetVisualization();
                    showToast(`Tuning preset "${labelText}" applied!`, "🎼");
                },

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
                            if (id === tabId) btn.classList.add('active');
                            else btn.classList.remove('active');
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

                handleUpgradeSearch: function(query) {
                    const container = document.getElementById('find-upgrade-search-results');
                    if (!container) return;
                    const hasQuery = !!(query && query.trim());
                    container.classList.remove('hidden');
                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const matches = dataset.filter(item => {
                        if (!hasQuery) return true;
                        const searchableText = `${item.name} ${item.brand || ''} ${item.model || ''}`;
                        return PEQDB_Module.matchSearchTokens(searchableText, query);
                    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                    if (matches.length === 0) {
                        container.innerHTML = '<div class="p-1 text-zinc-500 italic text-xs">No matching IEM found.</div>';
                        return;
                    }

                    container.innerHTML = matches.map(item => `
                        <div onclick="FindEngine.setUpgradeBaseIem('${item.id}', '${item.name.replace(/'/g, "\\'")}')" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800">
                            ${item.name}
                        </div>
                    `).join('');
                },

                setUpgradeBaseIem: function(id, name) {
                    this.selectedUpgradeBaseIemId = id;
                    const searchInput = document.getElementById('find-upgrade-search');
                    const searchResults = document.getElementById('find-upgrade-search-results');
                    const baseSlot = document.getElementById('find-upgrade-base-slot');

                    if (searchInput) searchInput.value = '';
                    if (searchResults) searchResults.classList.add('hidden');

                    if (baseSlot) {
                        baseSlot.className = "w-full h-9 bg-[var(--bg-card)] border-2 border-[var(--border-color)] px-2.5 py-1 flex items-center justify-between gap-2 select-none relative shadow-[2px_2px_0px_0px_var(--border-color)]";
                        baseSlot.innerHTML = `
                            <div class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                <span class="emoji-font vibrant-emoji text-sm flex-shrink-0 leading-none">📱</span>
                                <span class="text-xs font-black text-[var(--text-main)] truncate">${name}</span>
                            </div>
                            <button type="button" onclick="FindEngine.clearUpgradeBaseIem()" class="w-5 h-5 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Change the base IEM">✕</button>
                        `;
                    }

                    this._upgradeHasRun = false;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');
                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.remove('hidden');
                    if (overlay) overlay.classList.add('hidden');
                },

                clearUpgradeBaseIem: function() {
                    this.selectedUpgradeBaseIemId = null;
                    this._upgradeHasRun = false;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');
                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.remove('hidden');
                    if (overlay) overlay.classList.add('hidden');
                    const baseSlot = document.getElementById('find-upgrade-base-slot');

                    if (baseSlot) {
                        baseSlot.className = "w-full h-9 border-2 border-dashed border-black bg-black/10 flex items-center justify-center select-none";
                        baseSlot.innerHTML = `<span class="text-[9px] font-black text-stone-400 uppercase tracking-wider">+ Select Base IEM</span>`;
                    }
                },

                upgradeGoalList: [
                    { key: 'direct', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🎯</span> Direct Upgrade</span>' },
                    { key: 'detail', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🎧</span> Detail Upgrade</span>' },
                    { key: 'bass', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🔊</span> Bass Upgrade</span>' },
                    { key: 'vocal', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🎤</span> Vocal Upgrade</span>' },
                    { key: 'gaming', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🎮</span> Gaming Upgrade</span>' },
                    { key: 'stage', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">🌌</span> Soundstage Upgrade</span>' },
                    { key: 'tech', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">⚙️</span> Driver Tech Upgrade</span>' },
                    { key: 'refine', label: '<span class="flex items-center justify-center gap-1.5 truncate text-[var(--text-main)] font-black uppercase tracking-wider"><span class="emoji-font vibrant-emoji text-xl w-6 h-6 flex-shrink-0 inline-flex items-center justify-center leading-none anim-toggle-pop">✨</span> Tuning Refinement</span>' }
                ],
                currentGoalIdx: 0,

                cycleGoalIndex: function(dir) {
                    const total = this.upgradeGoalList.length;
                    this.currentGoalIdx = (this.currentGoalIdx + dir + total) % total;
                    const goal = this.upgradeGoalList[this.currentGoalIdx];
                    this.selectedUpgradeGoal = goal.key;

                    const btn = document.getElementById('ug-goal-cycle-btn');
                    if (btn) btn.innerHTML = goal.label;

                    if (this.selectedUpgradeBaseIemId && this._upgradeHasRun) {
                        this.renderUpgradePathway();
                    }
                },

                selectUpgradeGoal: function(goalKey) {
                    const idx = this.upgradeGoalList.findIndex(g => g.key === goalKey);
                    if (idx !== -1) {
                        this.currentGoalIdx = idx;
                        this.selectedUpgradeGoal = goalKey;
                        const btn = document.getElementById('ug-goal-cycle-btn');
                        if (btn) btn.innerHTML = this.upgradeGoalList[idx].label;
                    }
                    if (this.selectedUpgradeBaseIemId && this._upgradeHasRun) {
                        this.renderUpgradePathway();
                    }
                },

                verifyGoalAcoustics: function(candInterp, baseInterp, freqs, goal) {
                    if (!candInterp || !baseInterp || !freqs) return { passed: false, reason: "Missing Curve Data" };

                    const getBandAvg = (interp, minHz, maxHz, offset = 0) => {
                        let sum = 0, count = 0;
                        for (let i = 0; i < freqs.length; i++) {
                            if (freqs[i] >= minHz && freqs[i] <= maxHz) {
                                sum += (interp[i] + offset);
                                count++;
                            }
                        }
                        return count > 0 ? sum / count : 75;
                    };

                    const baseMid = getBandAvg(baseInterp, 400, 1000, 0);
                    const candMidRaw = getBandAvg(candInterp, 400, 1000, 0);
                    const alignOffset = baseMid - candMidRaw;

                    const candSubBass = getBandAvg(candInterp, 20, 80, alignOffset);
                    const baseSubBass = getBandAvg(baseInterp, 20, 80, 0);
                    const candMidrange = getBandAvg(candInterp, 400, 1000, alignOffset);
                    const candTreble = getBandAvg(candInterp, 10000, 16000, alignOffset);
                    const baseTreble = getBandAvg(baseInterp, 10000, 16000, 0);
                    const candPinna = getBandAvg(candInterp, 1500, 3500, alignOffset);

                    const candBassBoost = candSubBass - candMidrange;

                    if (goal === 'direct') {
                        let totalDiff = 0;
                        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs(candInterp[i] - baseInterp[i]);
                        const mae = totalDiff / freqs.length;
                        const passed = (mae <= 2.8);
                        return { passed, reason: passed ? "High Tonal Match to Base IEM" : "Tuning Deviates From Base" };
                    } else if (goal === 'bass') {
                        const passed = (candBassBoost >= 6.5) || (candSubBass >= baseSubBass + 1.8);
                        return { passed, reason: passed ? "Measured +6.5dB Sub-Bass Shelf" : "Lacks Measured Sub-Bass Elevation" };
                    } else if (goal === 'detail') {
                        const passed = (candTreble >= baseTreble + 1.0) && (candPinna >= candMidrange + 3.5);
                        return { passed, reason: passed ? "Measured High-Treble Extension" : "Treble Air Rolled Off" };
                    } else if (goal === 'vocal') {
                        const pinnaGain = candPinna - candMidrange;
                        const passed = (pinnaGain >= 5.5 && pinnaGain <= 11.5);
                        return { passed, reason: passed ? "Measured Smooth Vocal Pinna Gain" : "Pinna Gain Too Flat or Harsh" };
                    } else if (goal === 'stage') {
                        const passed = (candTreble >= baseTreble - 1.0) && (candPinna >= candMidrange + 2.5);
                        return { passed, reason: passed ? "Measured Spatial Air & Pinna Balance" : "Narrow High-Frequency Energy" };
                    } else if (goal === 'refine') {
                        let totalDiff = 0;
                        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs(candInterp[i] - baseInterp[i]);
                        const mae = totalDiff / freqs.length;
                        const passed = (mae <= 2.2);
                        return { passed, reason: passed ? "High Tonal Shape Continuity" : "Tonal Shape Deviates Too Far" };
                    } else if (goal === 'gaming') {
                        const passed = (candBassBoost >= 3.0) && (candPinna >= candMidrange + 2.5);
                        return { passed, reason: passed ? "Measured Footstep Bass & Pinna Presence" : "Lacks Gaming-Relevant Bass or Presence" };
                    } else if (goal === 'tech') {
                        const passed = (candTreble >= baseTreble + 0.5) && (candPinna >= candMidrange + 3.0);
                        return { passed, reason: passed ? "Measured Technical Treble Extension" : "Technical Treble Too Reserved" };
                    }

                    return { passed: false, reason: "No Acoustic Criteria For This Goal" };
                },

                hasGoalTag: function(tags, goal) {
                    if (!tags || !Array.isArray(tags)) return false;
                    const tagStr = tags.join(' ').toLowerCase();
                    if (goal === 'direct') return /balanced|smooth|reference|neutral|all-rounder/i.test(tagStr);
                    if (goal === 'bass') return /basshead|sub-bass|punchy/i.test(tagStr);
                    if (goal === 'detail') return /detailed|resolving|technical|analytical/i.test(tagStr);
                    if (goal === 'gaming') return /gaming|competitive|imaging|stage/i.test(tagStr);
                    if (goal === 'vocal') return /vocal|smooth|warm|mid/i.test(tagStr);
                    if (goal === 'stage') return /wide-stage|good-imaging|3d/i.test(tagStr);
                    if (goal === 'refine') return /balanced|smooth|reference|neutral/i.test(tagStr);
                    return false;
                },

                upgradeStepIndices: { 1: 0, 2: 0, 3: 0 },
                upgradeStepCandidates: { 1: [], 2: [], 3: [] },

                toggleUgCustomMenu: function(key) {
                    this._toggleCustomMenuPrefixed('ug', ['driver', 'connector', 'formfactor'], key);
                },

                selectUgCustomOption: function(key, value, htmlLabel) {
                    this._selectCustomOptionPrefixed('ug', key, value, htmlLabel);
                },

                syncUgDualRange: function(kind) {
                    this._syncDualRangePrefixed('ug', kind);
                    if (this._upgradeHasRun && this.selectedUpgradeBaseIemId) {
                        this.renderUpgradePathway();
                    }
                },

                drawUpgradeStepSparkline: function(stepNum) {
                    const pool = this.upgradeStepCandidates[stepNum];
                    if (!pool || pool.length === 0) return;
                    const curIdx = this.upgradeStepIndices[stepNum] || 0;
                    const c = pool[curIdx];
                    if (!c || !c.item) return;

                    const cardIdx = `ug_${stepNum}`;
                    const st = this.cardState[cardIdx] || { srcIdx: 0, roleIdx: 0 };
                    const srcIdx = st.srcIdx || 0;

                    const dbEntry = c.db || this.getDbEntry(c.item) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === c.item.id) : null);
                    const rawFiles = (dbEntry && Array.isArray(dbEntry.files)) ? dbEntry.files : (c.item.files || []);
                    const targetFilePath = rawFiles[srcIdx] || c.item.primaryFilePath;

                    const dsItem = PEQDB_Module.STATE.dataset.find(d => d.id === (dbEntry ? dbEntry.id : c.item.id));
                    if (!dsItem) return;

                    const doDraw = () => {
                        const subData = (dsItem.sourcesCache && dsItem.sourcesCache[targetFilePath]) ? dsItem.sourcesCache[targetFilePath] : dsItem.data;
                        if (!subData) return;

                        const sparkCanvas = document.getElementById('spark-ug-' + stepNum);
                        if (sparkCanvas) {
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

                            const norm = CurveUtils.normalizeTo75dB(subData, 500, 75);
                            sctx.strokeStyle = sparkColor;
                            sctx.lineWidth = 2.2;
                            sctx.lineJoin = 'round';
                            sctx.shadowColor = sparkColor;
                            sctx.shadowBlur = 4;
                            sctx.beginPath();
                            for (let i = 0; i < norm.length; i++) {
                                const x = (Math.log10(norm[i][0] / 20) / Math.log10(20000 / 20)) * sw;
                                const y = sh - ((norm[i][1] - 60) / 30) * sh;
                                if (i === 0) sctx.moveTo(x, y);
                                else sctx.lineTo(x, y);
                            }
                            sctx.stroke();
                        }

                        const marq = document.getElementById('marquee-ug-' + stepNum);
                        if (marq && !marq.classList.contains('marquee-orbit-active')) {
                            activateOrbitMarquee(marq);
                        }
                    };

                    if (!dsItem.data || dsItem.data.length < 2) {
                        CurveIndexer.loadCurve(dsItem, srcIdx).then(doDraw);
                    } else {
                        doDraw();
                    }
                },

                cycleUpgradeStep: function(stepNum, dir) {
                    const pool = this.upgradeStepCandidates[stepNum];
                    if (!pool || pool.length <= 1) return;

                    const total = pool.length;
                    let cur = this.upgradeStepIndices[stepNum] || 0;
                    cur = (cur + dir + total) % total;
                    this.upgradeStepIndices[stepNum] = cur;

                    this.cardState[`ug_${stepNum}`] = { srcIdx: 0, roleIdx: 0 };

                    const stepCard = document.getElementById(`ug-step-card-${stepNum}`);
                    if (stepCard) {
                        stepCard.outerHTML = this.renderStepCardHtml(stepNum);
                        setTimeout(() => this.drawUpgradeStepSparkline(stepNum), 50);
                    }
                },

                renderStepCardHtml: function(stepNum) {
                    const pool = this.upgradeStepCandidates[stepNum];
                    if (!pool || pool.length === 0) return '';

                    const curIdx = this.upgradeStepIndices[stepNum] || 0;
                    const c = pool[curIdx];
                    const total = pool.length;

                    const stepHeaderMap = {
                        1: { title: '🌱 STARTER', emoji: '🌱' },
                        2: { title: '🚀 LEAP', emoji: '🚀' },
                        3: { title: '👑 ENDGAME', emoji: '👑' }
                    };
                    const sInfo = stepHeaderMap[stepNum] || { title: `Step ${stepNum}`, emoji: '⭐' };

                    const name = c.db ? (c.db.variant ? `${c.db.brand} ${c.db.model} (${c.db.variant})` : `${c.db.brand} ${c.db.model}`) : c.item.name;

                    const price = c.price || '---';
                    const year = c.db ? c.db.year : null;
                    const driverType = c.db ? c.db.driver_type : null;
                    const driverConfig = c.db ? c.db.driver_config : null;
                    const connector = c.db ? c.db.connector : null;
                    const formFactorRaw = c.db ? (c.db.form_factor || 'IEM') : 'IEM';

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
                    const driverEmoji = FindEngine.driverEmojis[driverType] || '⚙️';
                    const driverTooltip = `${driverType || 'Driver'}${driverConfig ? ' (' + driverConfig + ')' : ''}`;
                    const connectorEmoji = FindEngine.connectorEmojis[connector] || '🔌';
                    const connectorTooltip = connector || 'Standard Connector';

                    const matchPct = c.tonalMatch || c.score || 0;
                    let scoreColorClass = "text-emerald-400";
                    if (matchPct < 75) scoreColorClass = "text-amber-400";
                    if (matchPct < 60) scoreColorClass = "text-rose-400";

                    const dbEntry = c.db || FindEngine.getDbEntry(c.item) || (PEQDB_Module.STATE.dataset ? PEQDB_Module.STATE.dataset.find(d => d.id === c.item.id) : null);
                    const driveability = dbEntry ? FindEngine.getDriveabilityStatus(dbEntry.impedance, dbEntry.sensitivity) : null;
                    const targetCurve = FindEngine.generateTargetCurve();
                    const freqs = CurveUtils.generateLogGrid(100);
                    const targetInterp = CurveUtils.normalizeTo75dB(targetCurve, 500, 75).map(pt => pt[1]);
                    const candInterp = c.item.interp || (c.item.data ? CurveUtils.cubicSplineInterpolate(CurveUtils.normalizeTo75dB(c.item.data, 500, 75), freqs) : null);
                    const eqFeat = candInterp ? FindEngine.calculateEQFeasibility(candInterp, targetInterp, freqs) : null;

                    const driveHtml = FindEngine.getShortDriveLabel(driveability);
                    const eqHtml = FindEngine.getShortEqLabel(eqFeat);

                    const rawTags = dbEntry ? dbEntry.tags : PEQDB_Module.analyzeCurveSignature(c.item.data);
                    const uniqueTags = [...new Set(rawTags || [])].slice(0, 4);
                    const tagsHtml = uniqueTags.map(t => {
                        const emoji = FindEngine.getTagEmoji(t);
                        return `<span class="find-tag-icon" data-tooltip="${t}">${emoji || '🏷️'}</span>`;
                    }).join('');

                    const rawFiles = (dbEntry && Array.isArray(dbEntry.files)) ? dbEntry.files : (c.item.files || []);
                    const fileCount = rawFiles.length;
                    const isMulti = fileCount > 1;

                    const cardIdx = `ug_${stepNum}`;
                    if (!FindEngine.cardState[cardIdx]) FindEngine.cardState[cardIdx] = { srcIdx: 0, roleIdx: 0 };
                    const currentSrcIdx = FindEngine.cardState[cardIdx].srcIdx;
                    const currentRoleOpt = FindEngine.cardRoleOptions[FindEngine.cardState[cardIdx].roleIdx];

                    const initialFilePath = rawFiles.length > 0 ? rawFiles[0] : '';
                    const initialParts = initialFilePath.split('/');
                    const initialSourceName = initialParts.length >= 2 ? initialParts[initialParts.length - 2] : 'Source';
                    const initialFileName = initialParts.length >= 1 ? initialParts[initialParts.length - 1].replace(/\.[^/.]+$/, '') : 'File';

                    const curveIdToLoad = dbEntry ? dbEntry.id : c.item.id;
                    const hasGraph = !!(c.item.data || fileCount > 0);

                    const ugGenreMatch = FindEngine.determineIemGenreMatch ? FindEngine.determineIemGenreMatch(c.item, dbEntry) : { emoji: '🎧', name: 'Pop' };
                    const ugGameGenreMatch = FindEngine.determineIemGameGenreMatch ? FindEngine.determineIemGameGenreMatch(c.item, dbEntry) : { emoji: '🎮', name: 'Video Game OST' };

                    return `
                        <div id="ug-step-card-${stepNum}" class="section-card p-3 flex flex-col justify-between hover:scale-[1.015] hover:shadow-2xl transition-all duration-200 relative overflow-hidden group">
                            <div class="space-y-2">
                                <div class="flex justify-between items-center select-none pb-1 border-b border-white/[0.06]">
                                    <span class="text-xs font-black uppercase tracking-wider text-amber-400 whitespace-nowrap">${sInfo.title}</span>
                                    <span class="text-lg font-black ${scoreColorClass} flex-shrink-0">${matchPct.toFixed(1)}%</span>
                                </div>

                                <div class="flex justify-between items-center text-xs select-none">
                                    <span class="text-[9px] font-mono text-zinc-400 font-bold">Option ${curIdx + 1} of ${total}</span>
                                    ${total > 1 ? `
                                        <div class="flex items-center gap-1">
                                            <button onclick="FindEngine.cycleUpgradeStep(${stepNum}, -1)" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Previous option">◄</button>
<button onclick="FindEngine.cycleUpgradeStep(${stepNum}, 1)" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Next option">►</button>
                                        </div>
                                    ` : ''}
                                </div>

                                <div class="flex items-center gap-2 w-full mt-1">
                                    <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0" data-id="${curveIdToLoad}" data-name="${name}" onclick="event.stopPropagation();">
                                    <div class="flex-1 overflow-hidden relative flex items-center h-5">
                                        <span id="marquee-ug-${stepNum}" class="text-xs font-black text-stone-200 inline-block whitespace-nowrap">${name}</span>
                                    </div>
                                </div>

                                <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                    <span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>
                                    ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                                    ${driverType ? `<span class="spec-icon-badge" data-tooltip="${driverTooltip}">${driverEmoji}</span>` : ''}
                                    ${connector ? `<span class="spec-icon-badge" data-tooltip="${connectorTooltip}">${connectorEmoji}</span>` : ''}
                                    <span class="spec-icon-badge" data-tooltip="${formTooltip}">${formEmoji}</span>
                                </div>

                                <div class="flex items-center gap-2 mt-1 w-full">
                                    <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title="Music Match: ${ugGenreMatch.name}">
                                        <div class="w-7 h-7 bg-[var(--bg-input)] border-2 border-black flex items-center justify-center flex-shrink-0 shadow-[1px_1px_0px_0px_#000]">
                                            <span class="emoji-font vibrant-emoji text-base leading-none">${ugGenreMatch.emoji}</span>
                                        </div>
                                        <span class="match-genre-name text-[9px] font-black uppercase text-stone-200 inline-block whitespace-nowrap">${ugGenreMatch.name}</span>
                                    </div>
                                    <div class="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden" title="Game Match: ${ugGameGenreMatch.name}">
                                        <div class="w-7 h-7 bg-[var(--bg-input)] border-2 border-black flex items-center justify-center flex-shrink-0 shadow-[1px_1px_0px_0px_#000]">
                                            <span class="emoji-font vibrant-emoji text-base leading-none">${ugGameGenreMatch.emoji}</span>
                                        </div>
                                        <span class="match-genre-name text-[9px] font-black uppercase text-stone-200 inline-block whitespace-nowrap">${ugGameGenreMatch.name}</span>
                                    </div>
                                </div>

                                <div class="h-[42px] w-full rounded-none border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
                                    <canvas id="spark-ug-${stepNum}" class="absolute inset-0 w-full h-full block opacity-85"></canvas>
                                </div>

                                ${isMulti ? `
                                    <div class="flex items-center gap-1 w-full h-7 mt-1.5">
                                        <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardSource('${cardIdx}', -1)" class="w-6 h-7 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0">◀</button>
                                        <div class="flex-1 bg-black/60 border-2 border-black px-1.5 h-7 flex items-center justify-start overflow-hidden text-left relative">
                                            <div id="src-stepper-container-${cardIdx}" class="w-full overflow-hidden text-left flex items-center justify-start">
                                                <span id="label-src-stepper-${cardIdx}" class="text-[8.5px] font-bold text-left inline-block whitespace-nowrap">
                                                    <span class="text-stone-300 font-bold">1/${fileCount}</span> <span class="text-[var(--accent-blue)] font-black">${initialSourceName}</span> <span class="text-stone-200 font-bold">(${initialFileName})</span>
                                                </span>
                                            </div>
                                        </div>
                                        <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardSource('${cardIdx}', 1)" class="w-6 h-7 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0">▶</button>
                                    </div>
                                ` : ''}

                                <div class="flex items-center justify-between w-full mt-2.5 px-1 text-[8.5px] font-mono select-none whitespace-nowrap">
                                    ${driveHtml}
                                    ${eqHtml}
                                </div>

                                <div class="flex items-center justify-center gap-3 w-full mt-1.5 pt-1">
                                    ${tagsHtml}
                                </div>
                            </div>

                            <div class="flex items-center gap-1.5 mt-3 pt-2 border-t-2 border-black ${hasGraph ? '' : 'hidden'}">
                                <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole('${cardIdx}', -1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                <button onclick="event.stopPropagation(); FindEngine.loadCardToGraph('${cardIdx}')" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none" >
                                    <span id="label-role-stepper-${cardIdx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                </button>
                                <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole('${cardIdx}', 1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
                            </div>
                        </div>
                    `;
                },

                renderUpgradePathway: async function() {
                    if (this.isScanning) return;
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');

                    if (!this.selectedUpgradeBaseIemId) {
                        showToast("Please select an owned/loved IEM in Step 1 first!", "⚠️");
                        return;
                    }
                    this._upgradeHasRun = true;
                    this.isScanning = true;

                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.add('hidden');
                    if (overlay) overlay.classList.remove('hidden');

                    const title = document.getElementById('find-scanning-title');
                    const subtitle = document.getElementById('find-scanning-subtitle');
                    if (title) title.textContent = "Generating Upgrade Pathway...";
                    if (subtitle) subtitle.textContent = "Calculating step-up acoustic ladders...";

                    setTimeout(async () => {
                        try {
                            const dataset = PEQDB_Module.STATE.dataset || [];
                            let baseItem = dataset.find(i => i.id === this.selectedUpgradeBaseIemId);

                            if (!baseItem && this.iemDatabase) {
                                const dbMatch = this.iemDatabase.find(d => d.id === this.selectedUpgradeBaseIemId);
                                if (dbMatch) baseItem = dbMatch;
                            }

                            if (!baseItem) {
                                showToast("Base IEM details missing.", "⚠️");
                                this.isScanning = false;
                                if (overlay) overlay.classList.add('hidden');
                                return;
                            }

                            const baseDb = this.getDbEntry(baseItem);
                            const basePrice = baseDb && baseDb.price_usd ? parseFloat(baseDb.price_usd) : (baseItem.price_usd ? parseFloat(baseItem.price_usd) : 20);
                            const baseFormFactor = baseDb ? (baseDb.form_factor || 'IEM') : (baseItem.form_factor || 'IEM');

                            const selectedFormFactors = this._getSpecSelection('ug', 'formfactor');
                            const selectedDrivers = this._getSpecSelection('ug', 'driver');
                            const selectedConnectors = this._getSpecSelection('ug', 'connector');

                            const priceMinEl = document.getElementById('ug-filter-price-min');
                            const priceMaxEl = document.getElementById('ug-filter-price-max');
                            const ugPriceMin = priceMinEl ? parseInt(priceMinEl.value) : 0;
                            const ugPriceMax = priceMaxEl ? parseInt(priceMaxEl.value) : 3000;

                            const yearMinEl = document.getElementById('ug-filter-year-min');
                            const yearMaxEl = document.getElementById('ug-filter-year-max');
                            const ugYearMin = yearMinEl ? parseInt(yearMinEl.value) : 1995;
                            const ugYearMax = yearMaxEl ? parseInt(yearMaxEl.value) : 2026;

                            if (!baseItem.data || baseItem.data.length < 2) {
                                await CurveIndexer.loadCurve(baseItem, 0);
                            }

                            const freqs = CurveUtils.generateLogGrid(100);
                            const baseNorm = CurveUtils.normalizeTo75dB(baseItem.data, 500, 75);
                            const baseInterp = CurveUtils.cubicSplineInterpolate(baseNorm, freqs);

                            const goal = this.selectedUpgradeGoal;
                            const candidateEntries = [];

                            // Pass 1: cheap metadata filters only.
                            for (let i = 0; i < dataset.length; i++) {
                                const cand = dataset[i];
                                if (cand.id === baseItem.id) continue;

                                const candDb = this.getDbEntry(cand);
                                const candPrice = candDb && candDb.price_usd ? parseFloat(candDb.price_usd) : (cand.price_usd ? parseFloat(cand.price_usd) : null);
                                const candYear = candDb && candDb.year ? parseInt(candDb.year) : 2022;

                                if (!candPrice || candPrice <= basePrice) continue;
                                if (candPrice < ugPriceMin || candPrice > ugPriceMax) continue;
                                if (candYear < ugYearMin || candYear > ugYearMax) continue;

                                const candFormFactor = candDb ? (candDb.form_factor || 'IEM') : (cand.form_factor || 'IEM');
                                if (selectedFormFactors.includes('auto')) {
                                    if (String(candFormFactor).toLowerCase() !== String(baseFormFactor).toLowerCase()) continue;
                                } else if (selectedFormFactors.length) {
                                    if (!selectedFormFactors.some(v => this._formFactorMatches(candDb, v))) continue;
                                }

                                if (selectedDrivers.length && !selectedDrivers.some(v => this.driverFilterMatches(candDb, v))) continue;
                                if (selectedConnectors.length && !selectedConnectors.some(v => this._connectorMatches(candDb, v))) continue;

                                candidateEntries.push({ item: cand, db: candDb, price: candPrice });
                            }

                            // Pass 2: Load curves for top relevant candidates without flooding network
                            const unloaded = candidateEntries.filter(c => !c.item.data || c.item.data.length < 2);
                            if (unloaded.length > 0) {
                                unloaded.sort((a, b) => {
                                    const aTag = this.hasGoalTag(a.db ? a.db.tags : a.item.tags, goal) ? 1 : 0;
                                    const bTag = this.hasGoalTag(b.db ? b.db.tags : b.item.tags, goal) ? 1 : 0;
                                    return bTag - aTag;
                                });
                                const toFetch = unloaded.slice(0, 150);
                                const batchSize = 25;
                                for (let i = 0; i < toFetch.length; i += batchSize) {
                                    const chunk = toFetch.slice(i, i + batchSize);
                                    await Promise.all(chunk.map(c => CurveIndexer.loadCurve(c.item, 0)));
                                    await new Promise(r => setTimeout(r, 0));
                                }
                            }

                            // Pass 3: scoring (sync).
                            const scoredCandidates = [];
                            for (const entry of candidateEntries) {
                                const cand = entry.item;
                                const candDb = entry.db;
                                const candPrice = entry.price;
                                if (!cand.data || cand.data.length < 2) continue;

                                const candNorm = CurveUtils.normalizeTo75dB(cand.data, 500, 75);
                                const candInterp = CurveUtils.cubicSplineInterpolate(candNorm, freqs);

                                let maeSum = 0;
                                for (let k = 0; k < freqs.length; k++) {
                                    maeSum += Math.abs(candInterp[k] - baseInterp[k]);
                                }
                                const mae = maeSum / freqs.length;
                                const tonalMatch = Math.max(0, 100 * Math.exp(-0.11 * mae));

                                if (tonalMatch < 60 && goal !== 'tech' && goal !== 'tier') continue;

                                const acousticTest = this.verifyGoalAcoustics(candInterp, baseInterp, freqs, goal);
                                const candTags = (candDb ? candDb.tags : cand.tags) || [];
                                const matchedTag = this.hasGoalTag(candTags, goal);

                                let score = tonalMatch;
                                let badgeHtml = '';

                                if (acousticTest.passed && matchedTag) {
                                    score += 35;
                                    badgeHtml = `<span class="text-[8.5px] font-black text-emerald-400 bg-emerald-950/40 border border-emerald-800/80 px-1.5 py-0.5 rounded">✅ Confirmed ${goal.toUpperCase()}</span>`;
                                } else if (acousticTest.passed && !matchedTag) {
                                    score += 20;
                                    badgeHtml = `<span class="text-[8.5px] font-black text-teal-400 bg-teal-950/40 border border-teal-800/80 px-1.5 py-0.5 rounded">🔬 Measured ${goal.toUpperCase()}</span>`;
                                } else if (!acousticTest.passed && matchedTag) {
                                    score -= 25;
                                    badgeHtml = `<span class="text-[8.5px] font-black text-rose-400 bg-rose-950/40 border border-rose-800/80 px-1.5 py-0.5 rounded">⚠️ Tag Conflict</span>`;
                                } else {
                                    badgeHtml = `<span class="text-[8.5px] font-bold text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">Standard Candidate</span>`;
                                }

                                if (goal === 'tech') {
                                    const typeScore = { 'DD': 1, 'BA': 2, 'Planar': 3, 'Hybrid': 4, 'Tribrid': 5 };
                                    const baseT = typeScore[baseDb ? baseDb.driver_type : 'DD'] || 1;
                                    const candT = typeScore[candDb ? candDb.driver_type : 'DD'] || 1;
                                    if (candT > baseT) score += (candT - baseT) * 15;
                                } else if (goal === 'refine') {
                                    score = tonalMatch * 1.5;
                                }

                                scoredCandidates.push({
                                    item: cand,
                                    db: candDb,
                                    price: candPrice,
                                    score: score,
                                    tonalMatch: tonalMatch,
                                    badgeHtml: badgeHtml,
                                    reason: acousticTest.reason
                                });
                            }

                            const candidates = scoredCandidates;
                            candidates.sort((a, b) => b.score - a.score);

                    const tier1Max = Math.max(basePrice * 2.5, 100);
                    const tier2Max = Math.max(basePrice * 6.0, 350);

                    let pool1 = candidates.filter(c => c.price <= tier1Max);
                    let pool2 = candidates.filter(c => c.price > tier1Max && c.price <= tier2Max);
                    let pool3 = candidates.filter(c => c.price > tier2Max);

                    if (pool1.length === 0 && candidates.length > 0) {
                        pool1 = candidates.slice(0, Math.ceil(candidates.length / 3));
                    }
                    if (pool2.length === 0 && candidates.length > 1) {
                        pool2 = candidates.slice(Math.ceil(candidates.length / 3), Math.ceil((candidates.length * 2) / 3));
                    }
                    if (pool3.length === 0 && candidates.length > 0) {
                        pool3 = candidates.slice(Math.ceil((candidates.length * 2) / 3));
                        if (pool3.length === 0) pool3 = [candidates[0]];
                    }

                    this.upgradeStepIndices = { 1: 0, 2: 0, 3: 0 };
                    this.upgradeStepCandidates = {
                        1: pool1,
                        2: pool2,
                        3: pool3
                    };

                    const activeStepNumbers = [1, 2, 3].filter(sNum => this.upgradeStepCandidates[sNum].length > 0);

                    if (activeStepNumbers.length === 0) {
                        if (grid) grid.innerHTML = '<div class="col-span-full text-center text-zinc-400 italic text-xs py-8">No matching upgrades found for these filter constraints. Try expanding your search options.</div>';
                        return;
                    }

                    if (grid) {
                        grid.innerHTML = activeStepNumbers.map(sNum => this.renderStepCardHtml(sNum)).join('');
                    }

                    setTimeout(() => {
                        activeStepNumbers.forEach(sNum => {
                            const pool = this.upgradeStepCandidates[sNum];
                            if (!pool || pool.length === 0) return;
                            const curIdx = this.upgradeStepIndices[sNum] || 0;
                            const c = pool[curIdx];
                            if (!c || !c.item || !c.item.data) return;

                            const sparkCanvas = document.getElementById('spark-ug-' + sNum);
                            if (sparkCanvas) {
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

                                const norm = CurveUtils.normalizeTo75dB(c.item.data, 500, 75);
                                sctx.strokeStyle = sparkColor;
                                sctx.lineWidth = 2.2;
                                sctx.lineJoin = 'round';
                                sctx.shadowColor = sparkColor;
                                sctx.shadowBlur = 4;
                                sctx.beginPath();
                                for (let i = 0; i < norm.length; i++) {
                                    const x = (Math.log10(norm[i][0] / 20) / Math.log10(20000 / 20)) * sw;
                                    const y = sh - ((norm[i][1] - 60) / 30) * sh;
                                    if (i === 0) sctx.moveTo(x, y);
                                    else sctx.lineTo(x, y);
                                }
                                sctx.stroke();
                            }

                            const marq = document.getElementById('marquee-ug-' + sNum);
                            activateOrbitMarquee(marq);
                        });
                    }, 100);

                        App.setFindSection('matches');

                        showToast("Upgrade Pathway Ladder generated!", "🚀");
                    } catch (err) {
                        console.error("[FindEngine] upgrade pathway failed:", err);
                        this._handleScanError(err);
                    } finally {
                        if (overlay) overlay.classList.add('hidden');
                        this.isScanning = false;
                    }
                }, 50);
            },

                _getCachedCardData: function(item, dbEntry, freqs) {
                    const key = (dbEntry && dbEntry.id != null) ? dbEntry.id : (item.id != null ? item.id : null);
                    if (!this._cardDataCache) this._cardDataCache = {};
                    if (key != null && this._cardDataCache[key] !== undefined) return this._cardDataCache[key];

                    const candInterp = item.interp || (item.data ? CurveUtils.cubicSplineInterpolate(CurveUtils.normalizeTo75dB(item.data, 500, 75), freqs) : null);

                    const rawTags = dbEntry ? dbEntry.tags : (item.data ? PEQDB_Module.analyzeCurveSignature(item.data) : []);
                    const uniqueTags = [...new Set(rawTags || [])].slice(0, 4);
                    const tagsHtml = uniqueTags.map(t => {
                        const emoji = FindEngine.getTagEmoji(t);
                        return `<span class="find-tag-icon" data-tooltip="${t}">${emoji || '🏷️'}</span>`;
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
                    if (key != null) this._cardDataCache[key] = data;
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

                    const scheduleChunk = () => {
                        if (chainActive || !matchesToRender.length) return;
                        chainActive = true;
                        setTimeout(() => { chainActive = false; renderChunk(); }, 16);
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
                                        <h4 id="blind-title-${idx}" class="text-xs font-bold blur-xs select-none">Reveal Required</h4>
                                        <div class="flex flex-wrap gap-1 mt-1.5">
                                            <span class="text-[8.5px] font-bold text-zinc-500">🔐 Profile Locked</span>
                                        </div>
                                    </div>
                                </div>
                                <div class="flex gap-2 mt-3 pt-2.5 border-t-2 border-black">
                                    <button onclick="FindEngine.revealIEM(this, '${finalName.replace(/'/g, "\\'")}', 'blind-title-${idx}')" class="flex-1 py-1.5 btn-clear text-[9px] font-black cursor-pointer">🔓 Reveal IEM</button>
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
                                            <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0 mt-0.5" data-id="${curveIdToLoad}" data-name="${finalName}" onclick="event.stopPropagation(); FindEngine.updateFloatingCompareBar();">
                                            <div class="flex-1 w-full">
                                                <span class="text-xs font-black text-stone-200 leading-snug line-clamp-2">${finalName}</span>
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                            ${price !== null && price !== undefined ? `<span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>` : ''}
                                            ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                                            ${driverType ? `<span class="spec-icon-badge" data-tooltip="${driverTooltip}">${driverEmoji}</span>` : ''}
                                            ${connector ? `<span class="spec-icon-badge" data-tooltip="${connectorTooltip}">${connectorEmoji}</span>` : ''}
                                            <span class="spec-icon-badge" data-tooltip="${formTooltip}">${formEmoji}</span>
                                        </div>

                                        <div class="h-[42px] w-full rounded-none border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
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
                                    <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole(${idx}, -1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                    <button onclick="event.stopPropagation(); FindEngine.loadCardToGraph(${idx})" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none" >
                                        <span id="label-role-stepper-${idx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                    </button>
                                    <button type="button" onclick="event.stopPropagation(); FindEngine.cycleCardRole(${idx}, 1)" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
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
                    if (this._findObserver) { this._findObserver.disconnect(); this._findObserver = null; }
                    const grid = document.getElementById('find-matches-grid');
                    if (grid) grid.innerHTML = '';
                    const countBar = document.getElementById('find-results-count');
                    if (countBar) countBar.classList.add('hidden');
                    const emptyState = document.getElementById('find-empty-state');
                    if (emptyState) emptyState.classList.remove('hidden');
                },

                toggleCardDrawer: async function(btn) {
                    const card = btn.closest('.section-card');
                    if (!card) return;
                    const drawer = card.querySelector('.find-sources-drawer');
                    if (!drawer) return;

                    const isHidden = drawer.classList.contains('hidden');
                    if (isHidden) {
                        drawer.classList.remove('hidden');
                        btn.textContent = '▲';

                        const cardId = btn.getAttribute('data-card-id');
                        const dsItem = PEQDB_Module.STATE.dataset.find(d => d.id === cardId);

                        if (dsItem && dsItem.files && dsItem.files.length > 1) {
                            const targetCurve = this.generateTargetCurve();
                            const freqs = CurveUtils.generateLogGrid(100);
                            const targetInterp = CurveUtils.normalizeTo75dB(targetCurve, 500, 75).map(pt => pt[1]);

                            for (let fIdx = 0; fIdx < dsItem.files.length; fIdx++) {
                                const filePath = dsItem.files[fIdx];
                                const scoreBadge = drawer.querySelector(`[data-sub-score-idx="${fIdx}"]`);

                                if (!dsItem.sourcesCache || !dsItem.sourcesCache[filePath]) {
                                    await CurveIndexer.loadCurve(dsItem, fIdx);
                                }

                                if (dsItem.sourcesCache && dsItem.sourcesCache[filePath]) {
                                    const subData = dsItem.sourcesCache[filePath];
                                    const realScore = this.calculateSubFileMatchScore(subData, targetInterp, freqs);

                                    if (realScore !== null && scoreBadge) {
                                        let scoreColor = "text-rose-400";
                                        if (realScore >= 90) scoreColor = "text-emerald-400";
                                        else if (realScore >= 80) scoreColor = "text-amber-400";
                                        scoreBadge.textContent = `${realScore.toFixed(1)}%`;
                                        scoreBadge.className = `text-[9px] font-black font-mono ${scoreColor} ml-1`;
                                    }
                                }
                            }
                        }

                        setTimeout(() => {
                            const marquees = drawer.querySelectorAll('span[id^="marquee-drawer-"]');
                            marquees.forEach(el => {
                                if (el && el.parentElement && el.parentElement.clientWidth > 0) {
                                    const pW = el.parentElement.clientWidth;
                                    const cW = el.scrollWidth;
                                    if (cW > pW) {
                                        const dist = -(cW - pW + 10);
                                        el.style.setProperty('--scroll-dist', `${dist}px`);
                                        el.classList.add('marquee-active');
                                    }
                                }
                            });
                        }, 50);
                    } else {
                        drawer.classList.add('hidden');
                        btn.textContent = '▼';
                    }
                },

                revealIEM: function(btn, realName, titleId) {
                    const titleEl = document.getElementById(titleId);
                    if (titleEl) {
                        titleEl.textContent = realName;
                        titleEl.classList.remove('blur-xs', 'select-none');
                    }

                    const iem = PEQDB_Module.STATE.dataset.find(i => i.name === realName || this.sanitizeName(i.name) === realName);
                    if (iem && btn && btn.parentElement) {
                        const parent = btn.parentElement;

                        const sigs = PEQDB_Module.analyzeCurveSignature(iem.data);
                        const tagsHtml = sigs.map(t => {
                            return `<span class="text-[8px] font-black px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.05] text-zinc-400 whitespace-nowrap">${t}</span>`;
                        }).join('');

                        const cardBody = parent.previousElementSibling;
                        if (cardBody) {
                            const tagSlot = cardBody.querySelector('div.flex.flex-wrap');
                            if (tagSlot) tagSlot.innerHTML = tagsHtml;
                        }

                        parent.innerHTML = `
                            <button onclick="FindEngine.loadToGraph('${iem.id}', 'base')" class="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-stone-200 rounded font-black text-[9px] cursor-pointer">📈 Base</button>
                            <button onclick="FindEngine.loadToGraph('${iem.id}', 'reference')" class="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-stone-200 rounded font-black text-[9px] cursor-pointer">🆚 Reference</button>
                        `;
                    }
                    showToast("IEM identity unlocked!", "🔓");
                },

                loadAndShow: function(id) {
                    IEM.loadFromLibrary(id);
                    App.switchTab('iem');
                },

                handleTasteSearch: function(query) {
                    const container = document.getElementById('find-taste-results');
                    if (!container) return;
                    const hasQuery = !!(query && query.trim());
                    container.classList.remove('hidden');

                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const dbList = this.iemDatabase || [];

                    const seenIds = new Set();
                    const candidates = [];

                    dataset.forEach(item => {
                        if (item && item.id) {
                            seenIds.add(item.id);
                            candidates.push(item);
                        }
                    });

                    dbList.forEach(db => {
                        if (db && db.id && !seenIds.has(db.id)) {
                            seenIds.add(db.id);
                            candidates.push({
                                id: db.id,
                                name: (db.variant ? `${db.brand} ${db.model} (${db.variant})` : `${db.brand} ${db.model}`).trim(),
                                brand: db.brand,
                                model: db.model,
                                variant: db.variant,
                                files: db.files || []
                            });
                        }
                    });

                    const matches = candidates.filter(item => {
                        if (!hasQuery) return true;
                        const filePaths = Array.isArray(item.files) ? item.files.join(' ') : (item.primaryFilePath || '');
                        const searchableText = `${item.name || ''} ${item.brand || ''} ${item.model || ''} ${item.variant || ''} ${filePaths} ${item.searchKey || ''}`;
                        return PEQDB_Module.matchSearchTokens(searchableText, query);
                    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                    if (matches.length === 0) {
                        container.innerHTML = '<span class="text-zinc-500 italic font-bold text-xs p-1 block">No matches found.</span>';
                        return;
                    }

                    let html = '';
                    const limit = matches.length;
                    for (let i = 0; i < limit; i++) {
                        const item = matches[i];
                        const isAdded = this.tasteFavorites.some(f => f.id === item.id);

                        html += `
                            <div class="peqdb-row-item flex items-center justify-between p-1.5 cursor-pointer hover:bg-[var(--bg-card)] mb-1 transition-all select-none" onclick="FindEngine.addTasteFavorite('${item.id}')">
                                <span class="text-xs text-stone-200 font-bold truncate flex-1 pr-2">${item.name}</span>
                                ${isAdded ? '<span class="text-[9px] text-rose-400 font-black flex-shrink-0 ml-1">✓ Added</span>' : '<span class="text-[9px] text-[var(--accent-blue)] font-black flex-shrink-0 ml-1">+ Add</span>'}
                            </div>
                        `;
                    }

                    container.innerHTML = html;
                },

                tasteFavorites: [],

                addTasteFavorite: function(id) {
                    if (this.tasteFavorites.length >= 3) {
                        showToast("Maximum 3 favorites. Remove one first.", "⚠️");
                        return;
                    }

                    let item = (PEQDB_Module.STATE.dataset || []).find(i => i.id === id);
                    if (!item && this.iemDatabase) {
                        const dbMatch = this.iemDatabase.find(d => d.id === id);
                        if (dbMatch) {
                            item = { id: dbMatch.id, name: `${dbMatch.brand} ${dbMatch.model}`.trim() };
                        }
                    }

                    if (!item) return;
                    if (this.tasteFavorites.some(f => f.id === id)) {
                        showToast("Already added!", "ℹ️");
                        return;
                    }

                    this.tasteFavorites.push({ id: item.id, name: item.name });
                    this.saveTasteFavorites();
                    this.renderTasteChips();

                    const searchInput = document.getElementById('find-taste-search');
                    const container = document.getElementById('find-taste-results');
                    if (searchInput) {
                        searchInput.value = '';
                    }
                    if (container) {
                        container.classList.add('hidden');
                    }

                    showToast('Added "' + item.name + '" to favorites!', '❤️');
                },

                removeTasteFavorite: function(id) {
                    this.tasteFavorites = this.tasteFavorites.filter(f => f.id !== id);
                    this.saveTasteFavorites();
                    this.renderTasteChips();
                },

                generateTasteFingerprint: async function() {
                    const box = document.getElementById('find-taste-fingerprint');
                    const textEl = document.getElementById('find-taste-fingerprint-text');
                    if (!box || !textEl) return;

                    if (this.tasteFavorites.length === 0) {
                        box.classList.add('hidden');
                        return;
                    }

                    box.classList.remove('hidden');

                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const selected = this.tasteFavorites.map(f => f.id);

                    await Promise.all(selected.map(async (id) => {
                        const item = dataset.find(i => i.id === id);
                        if (item && (!item.data || item.data.length < 2)) {
                            await CurveIndexer.loadCurve(item, 0);
                        }
                    }));

                    const freqs = CurveUtils.generateLogGrid(50);
                    const avgInterp = new Float32Array(freqs.length).fill(0);
                    let validCount = 0;

                    selected.forEach(id => {
                        const item = dataset.find(i => i.id === id);
                        if (item && item.data) {
                            const normalized = CurveUtils.normalizeTo75dB(item.data, 500, 75);
                            const interp = CurveUtils.cubicSplineInterpolate(normalized, freqs);
                            for (let i = 0; i < freqs.length; i++) avgInterp[i] += interp[i];
                            validCount++;
                        }
                    });

                    if (validCount === 0) {
                        textEl.textContent = "Search to analyze acoustic profile...";
                        return;
                    }

                    for (let i = 0; i < freqs.length; i++) avgInterp[i] /= validCount;

                    const getBandDb = (minHz, maxHz) => {
                        let sum = 0, count = 0;
                        for (let i = 0; i < freqs.length; i++) {
                            if (freqs[i] >= minHz && freqs[i] <= maxHz) {
                                sum += avgInterp[i];
                                count++;
                            }
                        }
                        return count > 0 ? (sum / count) : 75;
                    };

                    const subBass = getBandDb(20, 60);
                    const midBass = getBandDb(60, 250);
                    const midRef  = getBandDb(400, 800);
                    const vocals  = getBandDb(2000, 4000);
                    const treble  = getBandDb(6000, 10000);

                    const bassBoost = subBass - midRef;
                    const warmth = midBass - midRef;
                    const vocalPresence = vocals - midRef;
                    const trebleBoost = treble - midRef;

                    const traits = [];

                    if (bassBoost > 6.0) traits.push({ emoji: "🌊", label: "Sub-Bass Rumble" });
                    else if (bassBoost > 3.0) traits.push({ emoji: "🥊", label: "Punchy Slam" });
                    else traits.push({ emoji: "⚖️", label: "Neutral Bass" });

                    if (warmth > 2.0) traits.push({ emoji: "🌿", label: "Warm Mids" });
                    else traits.push({ emoji: "🧼", label: "Clean Mids" });

                    if (vocalPresence > 5.0) traits.push({ emoji: "🎤", label: "Forward Vocals" });
                    else if (vocalPresence < 2.0) traits.push({ emoji: "😌", label: "Relaxed Mids" });

                    if (trebleBoost > 3.0) traits.push({ emoji: "✨", label: "Crisp Sparkle" });
                    else if (trebleBoost < -2.0) traits.push({ emoji: "🌑", label: "Dark Treble" });
                    else traits.push({ emoji: "🧈", label: "Smooth Air" });

                    textEl.innerHTML = traits.map(t => `
                        <span class="spec-icon-badge" style="font-size: 20px !important; width: 26px !important; height: 26px !important;" data-tooltip="${t.label}">${t.emoji}</span>
                    `).join('');
                },

                renderTasteChips: function() {
                    const container = document.getElementById('find-taste-chips');
                    const btn = document.getElementById('find-taste-btn-scan');
                    if (!container) return;

                    container.innerHTML = '';

                    for (let i = 0; i < 3; i++) {
                        const f = this.tasteFavorites[i];
                        if (f) {
                            const div = document.createElement('div');
                            div.className = 'bg-[var(--bg-card)] border-2 border-[var(--border-color)] px-2.5 py-1 flex items-center justify-between gap-2 select-none w-full h-9 relative';
                            div.style.cssText = 'box-shadow: 2px 2px 0px 0px var(--border-color) !important;';
                            div.innerHTML = `
                                <div class="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                                    <span class="emoji-font vibrant-emoji text-lg flex-shrink-0 overflow-visible" style="line-height: 1.25;">❤️</span>
                                    <span class="text-xs font-black text-[var(--text-main)] truncate">${f.name}</span>
                                </div>
                                <button type="button" onclick="event.stopPropagation(); FindEngine.removeTasteFavorite('${f.id}')" class="w-5 h-5 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Remove ${f.name.replace(/"/g, '&quot;')}">✕</button>
                            `;
                            container.appendChild(div);
                        } else {
                            const div = document.createElement('div');
                            div.className = 'border-2 border-dashed border-black rounded-none h-9 flex items-center justify-center select-none w-full bg-black/10';
                            div.innerHTML = `<span class="text-[9px] font-black text-stone-400 uppercase tracking-wider">+ Favorite ${i + 1}</span>`;
                            container.appendChild(div);
                        }
                    }

                    if (btn) {
                        if (this.tasteFavorites.length >= 2) {
                            btn.disabled = false;
                            btn.classList.remove('cursor-not-allowed', 'opacity-40');
                        } else {
                            btn.disabled = true;
                            btn.classList.add('cursor-not-allowed', 'opacity-40');
                        }
                    }

                    this.generateTasteFingerprint();
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

                surpriseMe: function() {
                    if (!this._lastMatches || this._lastMatches.length === 0) {
                        showToast("Run a scan first to build a match list!", "⚠️");
                        return;
                    }
                    const pool = this._lastMatches.slice(0, Math.min(20, this._lastMatches.length));
                    const pick = pool[Math.floor(Math.random() * pool.length)];
                    this.loadToGraph(pick.id, 'reference');
                    App.switchTab('eq');
                    const matchText = (typeof pick.similarity === 'number' && !isNaN(pick.similarity))
                        ? ` — ${pick.similarity.toFixed(1)}% match!`
                        : `!`;
                    showToast(`🎲 Try the ${pick.name}${matchText}`, "🎲");
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

            const AppState = {
                get database() { return PEQDB_Module.STATE.dataset; },
                get activeCurves() { return PEQDB_Module.STATE.activeCurves; },
                get filters() { return FindEngine.filterTags; },
                get theme() { return App.themeMap[App.currentTheme] || null; },
                get charts() { return { radar: IEM_Module.radarChart || null }; },
                get audio() { return SharedAudio; }
            };
            window.AppState = AppState;
