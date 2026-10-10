// Find upgrade pathway: pick a base IEM and a goal, then step through verified upgrade candidates.
// Split out of find-engine.js; merged into FindEngine via Object.assign there.
const Find_UpgradeMethods = {
                handleUpgradeSearchDebounced: debounce(function(query) { FindEngine.handleUpgradeSearch(query); }, 160),

                selectedUpgradeBaseIemId: null,

                selectedUpgradeGoal: 'detail',

                handleUpgradeSearch: function(query) {
                    const container = document.getElementById('find-upgrade-search-results');
                    if (!container) return;
                    const hasQuery = !!(query && query.trim());
                    container.classList.remove('hidden');
                    const dataset = PEQDB_Module.STATE.dataset || [];
                    const matches = dataset.filter(item => {
                        if (!hasQuery) return true;
                        return PEQDB_Module.matchSearchTokensNorm(this._fnSearchNorm(item), query);
                    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

                    if (matches.length === 0) {
                        container.innerHTML = '<div class="p-1 text-zinc-500 italic text-xs">No matching IEM found.</div>';
                        return;
                    }

                    container.innerHTML = matches.map(item => `
                        <div data-cmd="FindEngine.setUpgradeBaseIem" data-arg-0="${escJs(item.id)}" data-arg-1="${escJs(item.name)}" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800">
                            ${esc(item.name)}
                        </div>
                    `).join('');
                },

                setUpgradeBaseIem: function(id, name) {
                    this.selectedUpgradeBaseIemId = id;
                    // Invalidate the cached base interp — the new base must
                    // not keep feeding step-card EQ badges scored against the
                    // previous IEM's curve.
                    this._upgradeBaseInterp = null;
                    this._upgradeBaseFreqs = null;
                    this._renderEpoch = (this._renderEpoch || 0) + 1; // kill pending chunk chains
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
                                <span class="text-xs font-black text-[var(--text-main)] truncate">${esc(name)}</span>
                            </div>
                            <button type="button" data-cmd="FindEngine.clearUpgradeBaseIem" class="w-5 h-5 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Change the base IEM">✕</button>
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
                    this._upgradeBaseInterp = null;
                    this._upgradeBaseFreqs = null;
                    this._renderEpoch = (this._renderEpoch || 0) + 1; // kill pending chunk chains
                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');
                    if (grid) grid.innerHTML = '';
                    if (emptyState) emptyState.classList.remove('hidden');
                    if (overlay) overlay.classList.add('hidden');
                    const baseSlot = document.getElementById('find-upgrade-base-slot');

                    if (baseSlot) {
                        // Same class list as the boot markup (index.html), so
                        // clearing back to the placeholder is not a second visual
                        // state. The old `border-2 border-dashed border-black`
                        // wrote raw Tailwind here: black dashes on a near-black
                        // card, i.e. an invisible outline, and no radius, so the
                        // box snapped from rounded to square-cored the moment you
                        // hit the change button. `slot-empty` carries the tokenised
                        // dashed outline + --r-md radius that every other slot uses.
                        baseSlot.className = "slot-empty w-full h-9 flex items-center justify-center select-none mt-1.5";
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
                        // Level-fit the MAE (mirror scoreInterp / find-worker):
                        // a pure level offset is not a tuning difference. The
                        // un-aligned loop rejected shape-identical
                        // level-shifted candidates while the card's tonalMatch
                        // (which DOES level-fit) called them near-clones.
                        let totalDiff = 0;
                        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs((candInterp[i] + alignOffset) - baseInterp[i]);
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
                        // Same level-fit as 'direct' (see above).
                        let totalDiff = 0;
                        for (let i = 0; i < freqs.length; i++) totalDiff += Math.abs((candInterp[i] + alignOffset) - baseInterp[i]);
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

                    // Escape DB-derived strings for attribute interpolation
                    // (the database is user-replaceable — same contract as
                    // renderEndgameResults/renderMatches).

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
                    // Score the EQ badge against the UPGRADE BASE IEM (stored
                    // by renderUpgradePathway), falling back to the Find target
                    // only when no upgrade scan is live. The old
                    // generateTargetCurve() read the Find-tab sliders — an
                    // unrelated earlier session's tuning produced the badge's
                    // boost/preamp advice.
                    const freqs = FindEngine._upgradeBaseFreqs || CurveUtils.generateLogGrid(100);
                    const targetInterp = FindEngine._upgradeBaseInterp
                        || CurveUtils.normalizeTo75dB(FindEngine.generateTargetCurve(), 500, 75).map(pt => pt[1]);
                    const candInterp = c.item.interp || (c.item.data ? CurveUtils.cubicSplineInterpolate(CurveUtils.normalizeTo75dB(c.item.data, 500, 75), freqs) : null);
                    const eqFeat = candInterp ? FindEngine.calculateEQFeasibility(candInterp, targetInterp, freqs) : null;

                    const driveHtml = FindEngine.getShortDriveLabel(driveability);
                    const eqHtml = FindEngine.getShortEqLabel(eqFeat);

                    const rawTags = dbEntry ? dbEntry.tags : PEQDB_Module.analyzeCurveSignature(c.item.data);
                    const uniqueTags = [...new Set(rawTags || [])].slice(0, 4);
                    const tagsHtml = uniqueTags.map(t => {
                        const emoji = FindEngine.getTagEmoji(t);
                        return `<span class="find-tag-icon" data-tooltip="${esc(t)}">${emoji || '🏷️'}</span>`;
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
                                            <button data-cmd="FindEngine.cycleUpgradeStep" data-arg-0="${stepNum}" data-arg-1="-1" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Previous option">◄</button>
<button data-cmd="FindEngine.cycleUpgradeStep" data-arg-0="${stepNum}" data-arg-1="1" class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Next option">►</button>
                                        </div>
                                    ` : ''}
                                </div>

                                <div class="flex items-center gap-2 w-full mt-1">
                                    <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0" data-id="${esc(curveIdToLoad)}" data-name="${esc(name)}" data-stop-propagation>
                                    <div class="flex-1 overflow-hidden relative flex items-center h-5">
                                        <span id="marquee-ug-${stepNum}" class="text-xs font-black text-stone-200 inline-block whitespace-nowrap">${esc(name)}</span>
                                    </div>
                                </div>

                                <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                    <span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>
                                    ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                                    ${driverType ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                                    ${connector ? `<span class="spec-icon-badge" data-tooltip="${esc(connectorTooltip)}">${connectorEmoji}</span>` : ''}
                                    <span class="spec-icon-badge" data-tooltip="${esc(formTooltip)}">${formEmoji}</span>
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

                                <div class="h-[42px] w-full border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
                                    <canvas id="spark-ug-${stepNum}" class="absolute inset-0 w-full h-full block opacity-85"></canvas>
                                </div>

                                ${isMulti ? `
                                    <div class="flex items-center gap-1 w-full h-7 mt-1.5">
                                        <button type="button" data-cmd="FindEngine.cycleCardSource" data-arg-0="${cardIdx}" data-arg-1="-1" class="w-6 h-7 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0">◀</button>
                                        <div class="flex-1 bg-black/60 border-2 border-black px-1.5 h-7 flex items-center justify-start overflow-hidden text-left relative">
                                            <div id="src-stepper-container-${cardIdx}" class="w-full overflow-hidden text-left flex items-center justify-start">
                                                <span id="label-src-stepper-${cardIdx}" class="text-[8.5px] font-bold text-left inline-block whitespace-nowrap">
                                                    <span class="text-stone-300 font-bold">1/${fileCount}</span> <span class="text-[var(--accent-blue)] font-black">${initialSourceName}</span> <span class="text-stone-200 font-bold">(${initialFileName})</span>
                                                </span>
                                            </div>
                                        </div>
                                        <button type="button" data-cmd="FindEngine.cycleCardSource" data-arg-0="${cardIdx}" data-arg-1="1" class="w-6 h-7 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-[10px] flex items-center justify-center cursor-pointer select-none focus:outline-none flex-shrink-0">▶</button>
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
                                <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${cardIdx}" data-arg-1="-1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                <button data-cmd="FindEngine.loadCardToGraph" data-arg-0="${cardIdx}" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none" >
                                    <span id="label-role-stepper-${cardIdx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                </button>
                                <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${cardIdx}" data-arg-1="1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
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

                    // Guard the pre-timeout region for the same reason as the
                    // other scans: nothing may throw while isScanning is true
                    // but outside a try, or the Find tab is wedged until restart.
                    try {
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
                            // Remember the upgrade base curve so the step
                            // cards' EQ-feasibility badge is scored against
                            // THIS base (the user's owned IEM), not the Find
                            // tab's unrelated tuning sliders.
                            this._upgradeBaseInterp = baseInterp;
                            this._upgradeBaseFreqs = freqs;

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
                                    badgeHtml = `<span class="text-[8.5px] font-black text-emerald-400 bg-emerald-950/40 border border-emerald-800/80 px-1.5 py-0.5">✅ Confirmed ${goal.toUpperCase()}</span>`;
                                } else if (acousticTest.passed && !matchedTag) {
                                    score += 20;
                                    badgeHtml = `<span class="text-[8.5px] font-black text-teal-400 bg-teal-950/40 border border-teal-800/80 px-1.5 py-0.5">🔬 Measured ${goal.toUpperCase()}</span>`;
                                } else if (!acousticTest.passed && matchedTag) {
                                    score -= 25;
                                    badgeHtml = `<span class="text-[8.5px] font-black text-rose-400 bg-rose-950/40 border border-rose-800/80 px-1.5 py-0.5">⚠️ Tag Conflict</span>`;
                                } else {
                                    badgeHtml = `<span class="text-[8.5px] font-bold text-zinc-500 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5">Standard Candidate</span>`;
                                }

                                if (goal === 'tech') {
                                    const typeScore = { 'DD': 1, 'BA': 2, 'Planar': 3, 'Hybrid': 4, 'Tribrid': 5, 'EST': 3, 'PZT': 2, 'BC': 2, 'MEMS': 3 };
                                    const baseT = typeScore[baseDb ? baseDb.driver_type : 'DD'] || 1;
                                    const candT = typeScore[candDb ? candDb.driver_type : 'DD'] || 1;
                                    if (candT > baseT) score += (candT - baseT) * 15;
                                } else if (goal === 'refine') {
                                    // Preserve the acoustic/tag adjustments above;
                                    // add a small continuity premium instead of
                                    // overwriting them.
                                    score += tonalMatch * 0.15;
                                }
                                score = Math.max(0, Math.min(100, score));

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
                    } catch (err) {
                        console.error("[FindEngine] upgrade pathway setup failed:", err);
                        this._handleScanError(err);
                    }
                },
};
