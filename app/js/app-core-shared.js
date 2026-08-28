// Split out of the former monolithic app-core.js (2026 refactor).
// Small shared top-level helpers (letter-scroll indicators, showDebugError,
// SimilarCurvesCache) used by multiple modules below. Load order preserved
// exactly -- see scripts/build-bundle.mjs.

(function migrateLegacyThemeIds() {
    try {
        const legacyMap = {
            pipboy: 'byte', synthwave: 'bit',
            void: 'slate', graphite: 'parchment', crimson: 'ember',
            ocean: 'circuit', sunset: 'cartridge', midnight: 'arcade', sakura: 'blush'
        };
        const saved = localStorage.getItem('settings_theme_id');
        if (saved && legacyMap[saved]) {
            localStorage.setItem('settings_theme_id', legacyMap[saved]);
        }
        const savedExport = localStorage.getItem('settings_export_theme_id');
        if (savedExport && legacyMap[savedExport]) {
            localStorage.setItem('settings_export_theme_id', legacyMap[savedExport]);
        }
    } catch (e) {
        console.warn("Theme id migration skipped:", e);
    }
})();

// Escape helpers: esc() for HTML text/attribute contexts, escJs() for inline
// single-quoted JS string values embedded in double-quoted HTML attributes.
// Used whenever user/dataset-derived strings are interpolated into innerHTML.
window.esc = function (s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};
window.escJs = function (s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, "\\'");
};

// iOS-style A-Z index rail. alphaKeyOf maps an entry to its bucket letter.
window.alphaKeyOf = function (it) {
    const c = String((it && (it.brand || it.name)) || '#').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
};

// Attach the centered letter bubble to a list, driven by its scroll position:
// as the user scrolls, show the letter of the section at the top, and hide the
// bubble shortly after they stop. No A-Z column is rendered.
// keyOf(scrollEl) returns the current letter (e.g. the topmost visible group's).
window.makeAlphaRail = function (hostEl, scrollEl, keyOf) {
    if (!hostEl || !scrollEl || hostEl.querySelector('.alpha-bubble')) return null;

    const bubble = document.createElement('div');
    bubble.className = 'alpha-bubble';
    bubble.style.display = 'none';
    hostEl.appendChild(bubble);

    let hideTimer = null;
    const hide = () => { if (hideTimer) clearTimeout(hideTimer); bubble.style.display = 'none'; };
    const show = (letter) => {
        if (!letter) return;
        bubble.textContent = letter;
        bubble.style.display = 'flex';
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 400);
    };

    scrollEl.addEventListener('scroll', () => {
        const letter = keyOf(scrollEl);
        if (letter) show(letter);
    }, { passive: true });

    // Hide immediately as soon as the cursor leaves the list, so the centered
    // bubble doesn't linger over neighboring columns (e.g. the EQ graph).
    document.addEventListener('pointermove', (e) => {
        const r = hostEl.getBoundingClientRect();
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) {
            hide();
        }
    }, true);

    return bubble;
};

// Determine the letter of the topmost visible brand group in the DB list.
function dbCurrentLetter(scrollEl) {
    const groups = scrollEl.querySelectorAll('[data-letter]');
    if (!groups.length) return null;
    const cTop = scrollEl.getBoundingClientRect().top;
    let letter = groups[0].getAttribute('data-letter');
    for (const g of groups) {
        if (g.getBoundingClientRect().top - cTop <= 6) letter = g.getAttribute('data-letter');
        else break;
    }
    return letter;
}

// Determine the letter of the topmost visible row in the flagship picker.
function gkCurrentLetter(scrollEl) {
    const rows = scrollEl.querySelectorAll('[data-letter]');
    if (!rows.length) return null;
    const cTop = scrollEl.getBoundingClientRect().top;
    let letter = rows[0].getAttribute('data-letter');
    for (const r of rows) {
        if (r.getBoundingClientRect().top - cTop <= 2) letter = r.getAttribute('data-letter');
        else break;
    }
    return letter;
}

// Wire the letter bubbles to the long, lettered lists.
window.bootstrapAlphabetIndex = function () {
    const dbWrapper = document.getElementById('peqdb-list-wrapper');
    const dbList = document.getElementById('peqdb-list');
    if (dbWrapper && dbList) makeAlphaRail(dbWrapper, dbList, dbCurrentLetter);

    const iemWrapper = document.getElementById('iem-db-results-box');
    const iemList = document.getElementById('iem-db-search-list');
    if (iemWrapper && iemList) makeAlphaRail(iemWrapper, iemList, dbCurrentLetter);

    const gkWrap = document.getElementById('find-gk-search-results');
    const gkList = document.getElementById('find-gk-scroll');
    if (gkWrap && gkList) makeAlphaRail(gkWrap, gkList, gkCurrentLetter);
};

(function wireGlobalErrorReporter() {
    const report = (msg) => {
        console.error('[Global Error]', msg);
        try {
            const bar = document.getElementById('find-results-count');
            const txt = document.getElementById('find-results-count-text');
            if (bar) bar.classList.remove('hidden');
            if (txt) {
                txt.textContent = '⚠️ ' + msg;
                txt.className = 'text-[9.5px] font-black uppercase tracking-wider text-rose-400';
            }
        } catch (_) {}
    };
    window.addEventListener('error', (event) => {
        report((event.error && event.error.message) || event.message || 'Unknown error');
    });
    window.addEventListener('unhandledrejection', (event) => {
        const r = event.reason;
        report((r && r.message) ? r.message : String(r));
    });
})();

    // Self-contained similarity scorer (no page globals) so it can be embedded
    // in the blob worker string AND reused inline. Scores every candidate's
    // `cachedInterp` against an already-interpolated target at `probes` (grid
    // indices). A broadband level offset is removed using the mid-band mean so
    // same-shape curves aren't punished for loudness, then a perceptually
    // weighted MAE is mapped to a similarity %.
    // Delegates to CurveUtils (single source of truth shared with find-worker.js)
    function computeSimilarityScores(targetInterp, dataset, probes, weights, midMask, threshold) {
        return CurveUtils.computeSimilarityScores(targetInterp, dataset, probes, weights, midMask, threshold);
    }

    const SimilarCurvesCache = {
    results: null,
    targetHash: "",
    query: "",
    // Cheap rolling hash over a curve's raw [f, dB] points. Captures content
    // changes (sculpting, drawing, re-measuring) even when the id/name stay
    // the same, which a bare id-based fingerprint would miss.
    hashCurvePoints: function(data) {
        if (!Array.isArray(data)) return '';
        let h = 2166136261 >>> 0;
        for (let i = 0; i < data.length; i++) {
            const p = data[i];
            if (Array.isArray(p) && p.length >= 2) {
                h ^= Math.round((p[0] || 0) * 100);
                h = Math.imul(h, 16777619) >>> 0;
                h ^= Math.round((p[1] || 0) * 100);
                h = Math.imul(h, 16777619) >>> 0;
            }
        }
        h ^= data.length;
        h = Math.imul(h, 16777619) >>> 0;
        return h.toString(36);
    },
    hashString: function(str) {
        let h = 2166136261 >>> 0;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619) >>> 0;
        }
        return h.toString(36);
    },
    getTargetFingerprint: function() {
        try {
            const baseCurve = PEQDB_Module.STATE.activeCurves.find(c => c.role === 'base' && c.visible);
            const baseId = baseCurve ? baseCurve.id : 'none';
            const resEnabled = EQ_Module.resonanceCalEnabled ? '1' : '0';
            const resHz = PEQDB_Module.resonanceHz || '8000';
            const alignHz = PEQDB_Module.alignHz || 'mean';
            const alignDb = PEQDB_Module.alignDb || '75';

            // The matching basis is the live DSP composite (baseline + EQ
            // response), so the fingerprint must include the current EQ state —
            // hashing only a loaded curve's id let band edits hit the cache and
            // return stale results while the graph visibly changed.
            const realValues = EQ_Module.getRealValues();
            let contentHash = this.hashString(JSON.stringify([realValues.preVal, realValues.mainVals, realValues.advVals]));
            if (baseCurve) {
                contentHash += '-' + this.hashCurvePoints(baseCurve.data);
            }

            return `${baseId}-${contentHash}-${resEnabled}-${resHz}-${alignHz}-${alignDb}`;
        } catch(e) {
            return "";
        }
    },
    isValid: function(currentQuery) {
        if (!this.results) return false;
        if (this.query !== currentQuery) return false;
        // A dirty flag means something changed in a way the fingerprint cannot
        // see (sculpt-point drags mutate activeTarget.data in place, leaving
        // activeId/res/align untouched). Without this check the stale pre-drag
        // match list kept rendering.
        if (PEQDB_Module && PEQDB_Module.similarDirty) return false;
        if (this.targetHash !== this.getTargetFingerprint()) return false;
        return true;
    }
};

function showDebugError(message, source) {
    let errDiv = document.getElementById('debug-error-banner');
    if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'debug-error-banner';
        errDiv.style = 'position:fixed; bottom:20px; left:20px; right:20px; background:rgba(220,38,38,0.95); color:white; font-family:monospace; font-size:11px; padding:12px; border-radius:6px; z-index:9999; border:1px solid #ef4444; box-shadow:0 10px 30px rgba(0,0,0,0.55); overflow-y:auto; max-height:180px;';
        document.body.appendChild(errDiv);
    }
    errDiv.innerHTML = `<strong>⚠️ JS Runtime Exception:</strong> ${message} <br> <span style="opacity:0.85; font-size:10px; margin-top:4px; display:block;">${source}</span>`;
}

window.addEventListener('error', function(e) {
    showDebugError(e.message, `File: ${e.filename.split('/').pop()} | Line: ${e.lineno} | Col: ${e.colno}`);
});

window.addEventListener('unhandledrejection', function(e) {
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    showDebugError(reason, 'Unhandled Promise Rejection');
});

