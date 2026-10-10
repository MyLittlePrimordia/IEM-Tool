// Find Endgame sets and Giant Killers: budget scoring, worker scan and results rendering.
// Split out of find-engine.js; merged into FindEngine via Object.assign there.
const Find_EndgameMethods = {
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
                            // No price bonus: must stay identical to the worker's
                            // scoreEndgameCategories (find-worker.js) — at equal
                            // acoustics the cheapest option should win, not the
                            // priciest affordable one. The local path previously
                            // added up to +5 for expensive items, so the same
                            // query ranked differently depending on whether the
                            // Worker was available.
                            const bonus = 0;
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
                    const reqId = 'e' + ((this._workerReqSeq = (this._workerReqSeq || 0) + 1));
                    return new Promise((resolve) => {
                        let retriedWithItems = false;
                        let settled = false;
                        let timer = null;
                        const cleanup = () => {
                            if (timer) { clearTimeout(timer); timer = null; }
                            worker.removeEventListener('message', onMsg);
                            worker.removeEventListener('error', onErr);
                            worker.removeEventListener('messageerror', onErr);
                        };
                        const done = (v) => {
                            if (settled) return;
                            settled = true;
                            cleanup();
                            resolve(v);
                        };
                        const armTimeout = () => {
                            if (timer) clearTimeout(timer);
                            timer = setTimeout(() => {
                                this._killFindWorker('endgame request timed out after ' + this.WORKER_TIMEOUT_MS + 'ms');
                                done(null);
                            }, this.WORKER_TIMEOUT_MS);
                        };
                        const onMsg = (e) => {
                            const d = e.data || {};
                            if (d.type !== 'result') return;
                            // Drop replies from other requests (tuning/upgrade
                            // listeners share this worker; every listener sees
                            // every message).
                            if (d.reqId !== reqId) return;
                            // Worker lost its memoized set: resend full payload once.
                            if (!d.ok && d.reprime && !retriedWithItems) {
                                retriedWithItems = true;
                                try {
                                    worker.postMessage({ type: 'endgame', reqId: reqId, items: items, maxPrice: maxPrice, freqs: freqs, sig: sig });
                                    this._workerCanonicalSig = sig;
                                    armTimeout();
                                } catch (postErr) {
                                    this._killFindWorker('postMessage failed during endgame reprime');
                                    done(null);
                                }
                                return;
                            }
                            // A worker-reported payload failure leaves the worker
                            // healthy, so it is NOT retired here.
                            if (!d.ok) { console.warn("[FindEngine] worker endgame failed:", d.error); return done(null); }
                            done(d.endgame);
                        };
                        const onErr = (e) => {
                            console.warn("[FindEngine] worker error:", e && e.message);
                            this._killFindWorker('error event: ' + ((e && e.message) || 'unknown'));
                            done(null);
                        };
                        worker.addEventListener('message', onMsg);
                        worker.addEventListener('error', onErr);
                        worker.addEventListener('messageerror', onErr);
                        armTimeout();
                        try {
                            if (workerHasSet) {
                                worker.postMessage({ type: 'endgame', reqId: reqId, maxPrice: maxPrice, freqs: freqs, sig: sig });
                            } else {
                                worker.postMessage({ type: 'endgame', reqId: reqId, items: items, maxPrice: maxPrice, freqs: freqs, sig: sig });
                                this._workerCanonicalSig = sig;
                            }
                        } catch (e) {
                            this._killFindWorker('postMessage threw: ' + e.message);
                            done(null);
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

                        // Shared driveability scorer (same one the upgrade and
                        // match cards use) reading the REAL DB fields. The old
                        // local block read impedance_ohm/sensitivity_db —
                        // fields that exist in 0/5131 entries — so every card
                        // rendered "Easy to drive", 300Ω sets included.
                        const driveStatus = dbEntry ? this.getDriveabilityStatus(dbEntry.impedance, dbEntry.sensitivity) : null;
                        let driveHtml;
                        if (driveStatus) {
                            driveHtml = `<span class="${driveStatus.color} font-bold">⚡ ${driveStatus.label}</span>`;
                        } else {
                            driveHtml = '<span class="text-zinc-500 font-bold">⚡ Drive: N/A</span>';
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
    ${totalOptions > 1 ? (() => {
    // The stepper used to pick the whole call inside the attribute:
    //   onclick="FindEngine.${isValueStrip ? 'cycleEndgameValue(-1)' : `cycleEndgamePick('${catId}', -1)`}"
    // which cannot be expressed as data attributes. Choose the command and its
    // args here instead, so the markup stays declarative.
    const prevCmd = isValueStrip ? 'FindEngine.cycleEndgameValue' : 'FindEngine.cycleEndgamePick';
    const nextCmd = isValueStrip ? 'FindEngine.cycleEndgameValue' : 'FindEngine.cycleEndgamePick';
    const prevArgs = isValueStrip ? ' data-arg-0="-1"' : ` data-arg-0="${esc(catId)}" data-arg-1="-1"`;
    const nextArgs = isValueStrip ? ' data-arg-0="1"' : ` data-arg-0="${esc(catId)}" data-arg-1="1"`;
    return `
    <div class="flex items-center gap-1">
    <button data-cmd="${prevCmd}"${prevArgs} class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Previous option">◄</button>
    <button data-cmd="${nextCmd}"${nextArgs} class="w-5 h-5 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] hover:text-white border-2 border-black text-[var(--text-main)] font-black text-[10px] flex items-center justify-center cursor-pointer select-none" title="Next option">►</button>
    </div>
    `; })() : ''}
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
                                            <input type="checkbox" class="find-compare-cb accent-[var(--accent-blue)] w-3.5 h-3.5 cursor-pointer flex-shrink-0" data-id="${esc(curveIdToLoad)}" data-name="${esc(finalName)}" data-cmd="FindEngine.updateFloatingCompareBar">
                                            <div class="flex-1 overflow-hidden relative flex items-center h-5">
                                                <span id="${marqId}" class="text-xs font-black text-stone-200 inline-block whitespace-nowrap">${esc(finalName)}</span>
                                            </div>
                                        </div>

                                        <div class="flex items-center justify-start gap-2.5 px-0.5 py-0.5 mt-1 select-none font-mono">
                                            ${price !== null && price !== undefined ? `<span class="text-[10px] font-black text-amber-400 whitespace-nowrap">💰 $${price}</span>` : ''}
                                            ${year ? `<span class="text-[10px] font-black text-stone-300 whitespace-nowrap">📅 ${year}</span>` : ''}
                        ${driverType ? `<span class="spec-icon-badge" data-tooltip="${esc(driverTooltip)}">${driverEmoji}</span>` : ''}
                        ${connector ? `<span class="spec-icon-badge" data-tooltip="${esc(connectorTooltip)}">${connectorEmoji}</span>` : ''}
                        <span class="spec-icon-badge" data-tooltip="${esc(formTooltip)}">${formEmoji}</span>
                                        </div>

                                        <div class="h-[42px] w-full border-2 border-black bg-black overflow-hidden relative mt-1.5 ${hasGraph ? '' : 'hidden'}">
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
                                    <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${cardIdx}" data-arg-1="-1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">◀</button>
                                    <button data-cmd="FindEngine.loadCardToGraph" data-arg-0="${cardIdx}" data-arg-1="${escJs(curveIdToLoad)}" class="flex-1 bg-[var(--bg-input)] hover:bg-zinc-800 text-[var(--text-main)] font-bold h-8 text-[9.5px] border-2 border-black px-2 cursor-pointer flex items-center justify-center truncate shadow-none focus:outline-none">
                                        <span id="label-role-stepper-${cardIdx}" class="flex items-center justify-center gap-1 truncate">${currentRoleOpt.label}</span>
                                    </button>
                                    <button type="button" data-cmd="FindEngine.cycleCardRole" data-arg-0="${cardIdx}" data-arg-1="1" class="w-8 h-8 bg-[var(--bg-input)] hover:bg-[var(--accent-blue)] border-2 border-black text-white font-black text-xs flex items-center justify-center cursor-pointer select-none focus:outline-none">▶</button>
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
                        return PEQDB_Module.matchSearchTokensNorm(this._fnSearchNorm(item), query);
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
                        // Numeric JS argument only: a '200+' display fallback
                        // interpolated here was a permanent SyntaxError for
                        // that row's onclick (and parseFloat('200+') fell
                        // back to 500 in the savings math). Keep the display
                        // string separate from the numeric argument.
                        const rawP = (db && db.price_usd != null) ? db.price_usd : (item.price_usd != null ? item.price_usd : null);
                        const numP = Number.isFinite(parseFloat(rawP)) ? parseFloat(rawP) : 250;
                        const dispP = rawP != null ? rawP : '200+';
                        return `
                            <div data-letter="${alphaKeyOf(item)}" data-cmd="FindEngine.setGkFlagship" data-arg-0="${escJs(item.id)}" data-arg-1="${escJs(item.name)}" data-arg-2="${numP}" class="p-1.5 bg-black/80 hover:bg-[var(--accent-blue)] hover:text-white cursor-pointer font-bold text-xs truncate border border-zinc-800 flex justify-between">
                                <span>${esc(item.name)}</span>
                                <span class="text-amber-400 font-mono ml-2">$${dispP}</span>
                            </div>
                        `;
                    }).join('');
                },

                setGkFlagship: function(id, name, price) {
                    this.selectedGkFlagshipId = id;
                    this.selectedGkFlagshipName = name;
                    this.selectedGkFlagshipPrice = parseFloat(price) || 500;
                    this._gkHasRun = false;
                    this._renderEpoch = (this._renderEpoch || 0) + 1; // kill pending chunk chains
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
                                <span class="text-xs font-black text-[var(--text-main)] truncate">${esc(name)} ($${this.selectedGkFlagshipPrice})</span>
                            </div>
                            <button type="button" data-cmd="FindEngine.clearGkFlagship" class="w-5 h-5 bg-rose-950/80 hover:bg-rose-600 text-rose-300 hover:text-white text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer flex-shrink-0 border border-black" title="Change the flagship target">✕</button>
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

                    const grid = document.getElementById('find-matches-grid');
                    const emptyState = document.getElementById('find-empty-state');
                    const overlay = document.getElementById('find-scanning-overlay');

                    try {
                        // Raise the flag INSIDE the try so no throw can leave it
                        // stuck true — all 5 scan entry points early-return on
                        // `isScanning`, so a stuck flag kills the whole Find tab.
                        this.isScanning = true;
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
};
