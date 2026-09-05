/* Endgame Sets — category config.
 * -----------------------------------------------------------------------
 * Defines the 8 curve-grounded categories used by the Find tab's
 * "Endgame" scan (top-N candidate pool per category).
 *
 * Each category combines:
 *   - tagRegex     : matched against the item's `tags` array (same pattern
 *                    as hasGoalTag() in find-worker.js). Tags in
 *                    database.json were assigned from aggregated online
 *                    review consensus, so a tag match is real signal, not
 *                    a guess — it's just opinion-grounded rather than
 *                    measurement-grounded.
 *   - curveCheck    : pure function over an already-normalized/interpolated
 *                     response (500Hz aligned to 75dB, per
 *                     CurveUtils.normalizeTo75dB + cubicSplineInterpolate)
 *                     that returns a 0-100 score plus a human-readable
 *                     reason string, same contract as
 *                     verifyGoalAcoustics() in find-worker.js.
 *   - tagWeight / curveWeight : how much each signal contributes to the
 *                     category's composite score. Categories with a real
 *                     acoustic signature (Basshead, Vocals, Detail,
 *                     All-Rounder) lean curve-heavy. Categories where FR
 *                     alone is a weak proxy for the concept (Technical,
 *                     Gaming) lean tag-heavy on purpose — see the per-
 *                     category comments below.
 *
 *   The tag bonus is CONDITIONAL on the curve corroborating it: the tag
 *   credit scales with curveScore (full weight at curveScore >= 40, linear
 *   below), so a tag alone can never elect a Champion whose response
 *   doesn't actually measure up — evidence and opinion must agree.
 *
 * NOTE: this file defines the scoring rubric, wired into find-worker.js
 * (scoreEndgameCategories / the 'endgame' worker message) and app-core.js
 * (FindEngine.scanEndgameSets, Endgame tab).
 *
 * Musical / Value / OVERALL are deliberately excluded — no tag and no
 * curve proxy exists for "musicality", "value" needs a quality signal
 * that isn't in the data, and "OVERALL" has no ground truth to aggregate
 * against. See the Find-tab Endgame roadmap discussion for the reasoning.
 * -----------------------------------------------------------------------
 */

(function (root) {
    'use strict';

    // ---- Shared helpers -----------------------------------------------
    // Mirrors the getBandAvg() closure inside verifyGoalAcoustics() in
    // find-worker.js — kept standalone here so this file has no hard
    // dependency on that function's scope.
    function getBandAvg(interp, freqs, minHz, maxHz) {
        let sum = 0, count = 0;
        for (let i = 0; i < freqs.length; i++) {
            if (freqs[i] >= minHz && freqs[i] <= maxHz) {
                sum += interp[i];
                count++;
            }
        }
        return count > 0 ? sum / count : 75;
    }

    // Curves are normalized so 500Hz == 75dB (CurveUtils.normalizeTo75dB),
    // and the 400-1000Hz band is used elsewhere in the app (find-worker.js
    // verifyGoalAcoustics) as the stable "midrange reference" for a given
    // curve. Re-used here for the same reason: it's the flattest, most
    // reliably-measured region across drivers/rigs, so boosts/cuts
    // elsewhere are measured relative to it rather than to the absolute
    // 75dB normalization point (which can drift slightly after splining).
    function midRef(interp, freqs) {
        return getBandAvg(interp, freqs, 400, 1000);
    }

    // Maps a raw dB delta to a 0-100 score using a soft threshold curve —
    // same exp-decay shape used by scoreInterp() in find-worker.js, so
    // Endgame scores sit on a visually consistent scale with tuning-match
    // percentages shown elsewhere in Find.
    function dbToScore(delta, idealDelta, tolerance) {
        const dist = Math.abs(delta - idealDelta);
        return Math.max(0, Math.min(100, 100 * Math.exp(-dist / tolerance)));
    }

    // For categories that want "at least this much boost", not "exactly
    // this much" — score saturates at 100 once the threshold is cleared
    // instead of decaying past it.
    function dbAtLeastScore(delta, minDelta, tolerance) {
        if (delta >= minDelta) return 100;
        return Math.max(0, Math.min(100, 100 * Math.exp(-(minDelta - delta) / tolerance)));
    }

    // ---- Category definitions ------------------------------------------

    const ENDGAME_CATEGORIES = [

        {
            id: 'basshead',
            label: 'Basshead',
            emoji: '🔴',
            tagRegex: /basshead|sub-bass|punchy/i,
            tagWeight: 0.35,
            curveWeight: 0.65,
            // Strong signal: sub-bass shelf is one of the most reliably
            // measured things on an FR graph.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const subBass = getBandAvg(interp, freqs, 20, 80);
                const boost = subBass - mid;
                const score = dbAtLeastScore(boost, 6.5, 4.0);
                return {
                    score: score,
                    reason: boost >= 6.5
                        ? `Measured +${boost.toFixed(1)}dB sub-bass shelf`
                        : `Only +${boost.toFixed(1)}dB sub-bass over midrange`
                };
            }
        },

        {
            id: 'allrounder',
            label: 'All-Rounder',
            emoji: '🎯',
            tagRegex: /balanced|neutral|reference|all-rounder/i,
            tagWeight: 0.30,
            curveWeight: 0.70,
            // Strong signal: flatness vs. the 400-1000Hz reference across
            // the full audible range is directly measurable.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                let diffSum = 0, count = 0;
                for (let i = 0; i < freqs.length; i++) {
                    if (freqs[i] >= 100 && freqs[i] <= 10000) {
                        diffSum += Math.abs(interp[i] - mid);
                        count++;
                    }
                }
                const mae = count > 0 ? diffSum / count : 99;
                const score = Math.max(0, Math.min(100, 100 * Math.exp(-mae / 2.5)));
                return {
                    score: score,
                    reason: `Avg ${mae.toFixed(1)}dB deviation from flat (100Hz-10kHz)`
                };
            }
        },

        {
            id: 'detail',
            label: 'Detail',
            emoji: '🔎',
            tagRegex: /detailed|resolving|analytical/i,
            tagWeight: 0.30,
            curveWeight: 0.70,
            // Decent proxy: treble extension + pinna gain correlate with
            // perceived "detail retrieval" but this is still an FR proxy
            // for something that's partly about driver behavior, not
            // just tonality.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const treble = getBandAvg(interp, freqs, 10000, 16000);
                const pinna = getBandAvg(interp, freqs, 1500, 3500);
                const trebleLift = treble - mid;
                const pinnaLift = pinna - mid;
                const trebleScore = dbAtLeastScore(trebleLift, 1.0, 3.0);
                const pinnaScore = dbAtLeastScore(pinnaLift, 3.5, 3.0);
                const score = (trebleScore * 0.5) + (pinnaScore * 0.5);
                return {
                    score: score,
                    reason: `Treble +${trebleLift.toFixed(1)}dB, pinna +${pinnaLift.toFixed(1)}dB vs. mids`
                };
            }
        },

        {
            id: 'vocals',
            label: 'Vocals',
            emoji: '🎤',
            tagRegex: /vocal-focused|vocal/i,
            tagWeight: 0.30,
            curveWeight: 0.70,
            // Strong signal: pinna gain (1.5-3.5kHz) relative to midrange
            // is the standard measured proxy for vocal presence/clarity.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const pinna = getBandAvg(interp, freqs, 1500, 3500);
                const pinnaGain = pinna - mid;
                // Ideal window is a range (5.5-11.5dB), not a single point —
                // score highest at the center of the window, same as the
                // 'vocal' goal check in verifyGoalAcoustics().
                const center = 8.5;
                const score = dbToScore(pinnaGain, center, 4.5);
                return {
                    score: score,
                    reason: `Pinna gain +${pinnaGain.toFixed(1)}dB vs. mids`
                };
            }
        },

        {
            id: 'soundstage',
            label: 'Soundstage',
            emoji: '🌌',
            tagRegex: /wide-stage|good-imaging/i,
            tagWeight: 0.45,
            curveWeight: 0.55,
            // Weak-ish proxy by nature: true soundstage needs crosstalk /
            // HRTF measurement this database doesn't have. Treble air +
            // pinna balance is the best available FR-only stand-in, so
            // tag weight is bumped up relative to Vocals/Basshead.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const air = getBandAvg(interp, freqs, 8000, 14000);
                const pinna = getBandAvg(interp, freqs, 1500, 3500);
                const airLift = air - mid;
                const pinnaLift = pinna - mid;
                const airScore = dbAtLeastScore(airLift, 2.0, 3.0);
                const pinnaScore = dbAtLeastScore(pinnaLift, 2.5, 3.0);
                const score = (airScore * 0.5) + (pinnaScore * 0.5);
                return {
                    score: score,
                    reason: `Air +${airLift.toFixed(1)}dB, pinna +${pinnaLift.toFixed(1)}dB vs. mids`
                };
            }
        },

        {
            id: 'technical',
            label: 'Technical',
            emoji: '⚙️',
            tagRegex: /technical|analytical|resolving/i,
            tagWeight: 0.35,
            curveWeight: 0.65,
            // Weakest curve signal of the 8 — "technicalities" (speed,
            // layering, resolution) isn't really present in a single FR
            // trace at all. Tag still matters, but capped at 0.35 so a tag
            // alone cannot outrank a clearly better measurement (a 40-curve
            // with tag must not beat a 100-curve without one).
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const upperMid = getBandAvg(interp, freqs, 2000, 5000);
                const treble = getBandAvg(interp, freqs, 10000, 16000);
                const upperMidLift = upperMid - mid;
                const trebleLift = treble - mid;
                // Score each band then average (consistent with Detail/Fun)
                // so a deficiency in one band cannot hide behind the other.
                const score = (dbAtLeastScore(upperMidLift, 1.5, 4.0) + dbAtLeastScore(trebleLift, 1.5, 4.0)) / 2;
                return {
                    score: score,
                    reason: `Upper-mid/treble clarity lift +${((upperMidLift + trebleLift) / 2).toFixed(1)}dB (weak proxy — tag-weighted)`
                };
            }
        },

        {
            id: 'gaming',
            label: 'Gaming',
            emoji: '🎮',
            tagRegex: /gaming|competitive-gaming/i,
            tagWeight: 0.35,
            curveWeight: 0.65,
            // Weak curve signal, same caveat as Technical — imaging speed
            // and transient response aren't captured by FR. Tag capped at
            // 0.35 for the same measurement-first reason as Technical.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const pinna = getBandAvg(interp, freqs, 1500, 3500);
                const air = getBandAvg(interp, freqs, 8000, 14000);
                const pinnaLift = pinna - mid;
                const airLift = air - mid;
                const score = (dbAtLeastScore(pinnaLift, 2.0, 4.0) + dbAtLeastScore(airLift, 2.0, 4.0)) / 2;
                return {
                    score: score,
                    reason: `Imaging-band lift +${((pinnaLift + airLift) / 2).toFixed(1)}dB (weak proxy — tag-weighted)`
                };
            }
        },

        {
            id: 'fun',
            label: 'Fun',
            emoji: '🎉',
            tagRegex: /\bfun\b|v-shaped/i,
            tagWeight: 0.30,
            curveWeight: 0.70,
            // Strong signal: V-shape (elevated bass AND elevated treble
            // vs. midrange) is directly measurable, same building blocks
            // as Basshead + Detail combined.
            curveCheck: function (interp, freqs) {
                const mid = midRef(interp, freqs);
                const bass = getBandAvg(interp, freqs, 20, 120);
                const treble = getBandAvg(interp, freqs, 8000, 14000);
                const bassLift = bass - mid;
                const trebleLift = treble - mid;
                const bassScore = dbAtLeastScore(bassLift, 4.0, 3.5);
                const trebleScore = dbAtLeastScore(trebleLift, 2.0, 3.5);
                const score = (bassScore * 0.5) + (trebleScore * 0.5);
                return {
                    score: score,
                    reason: `Bass +${bassLift.toFixed(1)}dB, treble +${trebleLift.toFixed(1)}dB vs. mids (V-shape)`
                };
            }
        }
    ];

    // ---- Composite scorer ------------------------------------------------
    // Combines tag match + curve check into the single 0-100 score the
    // Endgame scan ranks candidates by. `budgetPositionBonus` is left as a
    // separate, small additive term applied by the caller (scanEndgameSets
    // / the worker's 'endgame' handler) once maxPrice is known, since this
    // file has no notion of the user's budget.
    function scoreCategory(category, tags, interp, freqs) {
        const tagStr = Array.isArray(tags) ? tags.join(' ') : '';
        const tagMatch = category.tagRegex.test(tagStr);
        const curveResult = category.curveCheck(interp, freqs);

        // The tag bonus is conditional on the curve corroborating it — a
        // "Basshead" tag on a flat response is opinion with no evidence
        // behind it, so it earns partial credit scaled by how strongly the
        // measurement agrees (full credit at curveScore >= 40). Keeps the
        // review-consensus signal from overriding the measured response
        // in either direction.
        const tagCredit = tagMatch
            ? category.tagWeight * Math.min(1, curveResult.score / 40)
            : 0;

        const score = tagCredit * 100
                    + curveResult.score * category.curveWeight;

        let reason = curveResult.reason;
        if (tagMatch) {
            reason += curveResult.score >= 40
                ? ` — ${category.label} tag confirms`
                : ` — ${category.label} tag (curve disagrees)`;
        }

        return {
            score: score,
            tagMatch: tagMatch,
            curveScore: curveResult.score,
            reason: reason
        };
    }

    // Not a near-clone of the Champion — used to keep "Direct Rival" from
    // just being the same tuning in a different shell. Mirrors the
    // 'direct'/'refine' MAE thresholds already used in
    // verifyGoalAcoustics() (2.8 / 2.2).
    const DIRECT_RIVAL_MIN_MAE = 2.8;

    // Giant Killer price ceiling as a fraction of the Champion's price.
    // Tunable — see roadmap step 6 (tune against real output).
    const GIANT_KILLER_PRICE_FRACTION = 0.40;

    // Top-N pool cap: each category card cycles through the best
    // ENDGAME_MAX_PICKS candidates (plus the Giant Killer when it ranks
    // outside the cap), replacing the old 3 curated slots.
    const ENDGAME_MAX_PICKS = 12;

    const api = {
        ENDGAME_CATEGORIES: ENDGAME_CATEGORIES,
        scoreCategory: scoreCategory,
        getBandAvg: getBandAvg,
        midRef: midRef,
        DIRECT_RIVAL_MIN_MAE: DIRECT_RIVAL_MIN_MAE,
        GIANT_KILLER_PRICE_FRACTION: GIANT_KILLER_PRICE_FRACTION,
        ENDGAME_MAX_PICKS: ENDGAME_MAX_PICKS
    };

    // Usable from both a Worker (self) and the main thread (window).
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.EndgameCategories = api;
    }

})(typeof self !== 'undefined' ? self : this);
