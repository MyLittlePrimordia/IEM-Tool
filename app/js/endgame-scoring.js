/* Endgame rubric — SINGLE SOURCE OF TRUTH.
 *
 * This used to exist twice: `scoreEndgameCategories` in find-worker.js and a
 * ~90-line `_scoreEndgameCategoriesLocal` mirror in find-endgame.js. They had
 * already drifted once (an extra price bonus in the local copy changed the
 * ranking depending on whether the Worker was available), and every future
 * rule change would have had to be made twice.
 *
 * Loaded by:
 *   - the renderer bundle (after utils.js + endgame-categories.js), and
 *   - find-worker.js via importScripts(), so the worker and the main-thread
 *     fallback compute byte-identical pools.
 *
 * Pure logic: no DOM, no I/O, no page state.
 *
 * Pool keys are database ids, which are user-editable strings: they are kept in
 * a Map rather than an object so an id of "__proto__" cannot collide with
 * Object.prototype and silently drop a Giant Killer.
 */
const EndgameScoring = (function () {
    'use strict';

    function requireGlobals() {
        if (typeof EndgameCategories === 'undefined' || !EndgameCategories) {
            throw new Error('EndgameCategories unavailable — endgame-categories.js did not load');
        }
        if (typeof CurveUtils === 'undefined' || !CurveUtils || typeof CurveUtils.scoreInterp !== 'function') {
            throw new Error('CurveUtils unavailable — utils.js did not load');
        }
    }

    // For every rubric category, rank ALL priced candidates and return a
    // top-N pool (Option X of Y card cycling). Each pool member carries its
    // composite score, tag corroboration and role flags: the top pick is the
    // Champion; any budget clone of the Champion (>=75% curve similarity for
    // <=40% of its price) is flagged as a Giant Killer. A value strip then
    // collects the Giant Killers of all 8 champions into one cycling pool.
    function scoreEndgameCategories(cc, freqs, maxPrice) {
        requireGlobals();
        const EG = EndgameCategories;
        const cats = EG.ENDGAME_CATEGORIES || [];
        const maxPicks = EG.ENDGAME_MAX_PICKS || 12;

        // Only items with a real price inside the budget can be any of the
        // picks (Champion <= budget, Giant Killer <= 40% of the Champion's
        // price which is already <= budget).
        const priced = [];
        for (let i = 0; i < cc.length; i++) {
            const e = cc[i];
            if (!e.price || e.price > maxPrice) continue;
            priced.push(e);
        }

        const out = {};
        const champions = [];

        for (let c = 0; c < cats.length; c++) {
            const cat = cats[c];
            const scored = [];
            for (let i = 0; i < priced.length; i++) {
                const e = priced[i];
                const res = EG.scoreCategory(cat, e.tags, e.interp, freqs);
                // No price bonus: at equal acoustics the cheapest option should
                // win, not the priciest affordable one (price != quality).
                const bonus = 0;
                scored.push({
                    entry: e,
                    composite: res.score + bonus,
                    reason: res.reason,
                    tagMatch: res.tagMatch,
                    curveScore: res.curveScore
                });
            }

            if (scored.length === 0) {
                out[cat.id] = { pool: [] };
                continue;
            }

            scored.sort((a, b) => b.composite - a.composite);
            const champion = scored[0];

            // Giant Killer set: closest tuner under 40% of the Champion's price
            // wins (>=75% curve similarity). No brand constraint: same-brand
            // cheaper siblings are legit giant killers (e.g. Hexa under Nova).
            const gkCeiling = champion.entry.price * EG.GIANT_KILLER_PRICE_FRACTION;
            const gkSims = new Map();
            for (let i = 1; i < scored.length; i++) {
                const s = scored[i];
                if (s.entry.price > gkCeiling) continue;
                const sim = CurveUtils.scoreInterp(s.entry.interp, champion.entry.interp, freqs, true);
                if (sim >= 75) gkSims.set(s.entry.id, { sim: sim, s: s });
            }

            const pool = [];
            const limit = Math.min(maxPicks, scored.length);
            for (let i = 0; i < limit; i++) {
                const s = scored[i];
                const gk = gkSims.get(s.entry.id);
                const pick = {
                    id: s.entry.id,
                    name: s.entry.name,
                    price: s.entry.price,
                    brand: s.entry.brand || '',
                    score: Math.min(100, Math.round(s.composite)),
                    reason: s.reason,
                    tagMatch: !!s.tagMatch,
                    curveScore: Math.round(s.curveScore || 0)
                };
                if (i === 0) pick.isChampion = true;
                if (gk) {
                    pick.isGiantKiller = true;
                    pick.similarity = gk.sim;
                    pick.reason = `${gk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`;
                }
                pool.push(pick);
            }

            // A Giant Killer ranked outside the top-N cap still earns a slot —
            // budget clones are the whole point of the Endgame tab. The best
            // clone overall is also kept for the value strip.
            let bestGk = null;
            let bestGkAll = null;
            for (const [gkId, g] of gkSims) {
                if (!bestGkAll || g.sim > bestGkAll.sim) bestGkAll = g;
                if (pool.some(p => p.id === gkId)) continue;
                if (!bestGk || g.sim > bestGk.sim) bestGk = g;
            }
            if (bestGk) {
                pool.push({
                    id: bestGk.s.entry.id,
                    name: bestGk.s.entry.name,
                    price: bestGk.s.entry.price,
                    brand: bestGk.s.entry.brand || '',
                    score: Math.min(100, Math.round(bestGk.s.composite)),
                    reason: `${bestGk.sim.toFixed(1)}% tonal match to ${champion.entry.name}`,
                    tagMatch: !!bestGk.s.tagMatch,
                    curveScore: Math.round(bestGk.s.curveScore || 0),
                    isGiantKiller: true,
                    similarity: bestGk.sim
                });
            }

            champions.push({ id: champion.entry.id, name: champion.entry.name, interp: champion.entry.interp, price: champion.entry.price, gk: bestGkAll });
            out[cat.id] = { pool: pool };
        }

        // Value strip: the giant killers of all 8 category champions — the same
        // budget-clone rule as each category's pick (<=40% of the champion's
        // price, >=75% tonal match) — collected into one cycling pool, best
        // match first. Duplicate clones keep the strongest match.
        const valueById = new Map();
        for (let k = 0; k < champions.length; k++) {
            const ch = champions[k];
            const gk = ch.gk;
            if (!gk) continue;
            const e = gk.s.entry;
            const existing = valueById.get(e.id);
            if (existing && existing.similarity >= gk.sim) continue;
            valueById.set(e.id, { id: e.id, name: e.name, price: e.price, brand: e.brand || '', similarity: gk.sim, matchName: ch.name });
        }
        const valuePool = Array.from(valueById.values()).sort((a, b) => b.similarity - a.similarity);
        out._value = { pool: valuePool.slice(0, 12) };
        return out;
    }

    return { scoreEndgameCategories: scoreEndgameCategories };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = EndgameScoring;
