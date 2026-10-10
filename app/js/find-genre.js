// Find genre matching: music/game genre families, curve deltas and live genre detection.
// Split out of find-engine.js; merged into FindEngine via Object.assign there.
const Find_GenreMethods = {
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
            // Mirror getCurveDeltas: axes are relative to the 500Hz mids
            // reference, so the 500Hz fader acts as the reference (moving it
            // moves the badge) instead of being dropped.
            const m = b500;
            const sub = (b31 + b62) / 2 - m;
            const warmth = (b125 + b250) / 2 - m;
            const vocal = b1k - m;
            const treble = (b2k + b4k) / 2 - m;
            const air = (b8k + b16k) / 2 - m;
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
};
