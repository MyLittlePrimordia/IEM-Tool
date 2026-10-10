// EQ history: Undo / Redo for band edits, plus "remember my last EQ".
//
// Moved here from eq-smart-import.js (where the Ctrl+Z recorder used to live)
// so the snapshot/restore code stays with imports and everything about history
// lives in one file. It reuses EQ.snapshotEQState / EQ.restoreEQState.
//
//   Undo / Redo : a snapshot of the CURRENT state is taken just before each
//                 user gesture inside the EQ workspace (pointer press or
//                 arrow-key nudge). In memory only, capped at 20.
//   Remember    : the live state is saved to SafeStorage shortly after it
//                 changes and when the window is hidden or closed, then
//                 re-applied at launch (and after Settings > Refresh).
const EQ_History = (function () {
    var undoStack = [];
    var redoStack = [];
    var MAX = 20;
    var ZONES = '#eq-col-db, #eq-col-graph, #eq-col-console';
    // The undo/redo buttons must not record themselves as a gesture.
    var HISTORY_BTNS = '[data-cmd="EQ.undoEQ"], [data-cmd="EQ.redoEQ"]';
    var STORE_KEY = 'iem_last_eq_v1';
    var TYPES = ['peaking', 'lowshelf', 'highshelf', 'highpass', 'lowpass', 'notch'];
    var restored = false;
    var lastSavedKey = null;
    var saveTimer = null;

    function toast(msg, icon) {
        if (typeof showToast === 'function') showToast(msg, icon);
    }
    function snap() {
        var eq = window.EQ;
        if (!eq || typeof eq.snapshotEQState !== 'function') return null;
        var s = eq.snapshotEQState();
        return { key: JSON.stringify(s), snap: s };
    }
    function record(e) {
        try {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest(HISTORY_BTNS)) return;
            if (!t.closest(ZONES)) return;
            var cur = snap();
            if (!cur) return;
            var top = undoStack[undoStack.length - 1];
            if (top && top.key === cur.key) return;
            undoStack.push(cur);
            if (undoStack.length > MAX) undoStack.shift();
        } catch (_) {}
    }

    function undo(eq) {
        try {
            var zone = document.getElementById('eq-col-graph');
            if (!zone || zone.offsetParent === null) return false;
            var cur = snap();
            if (!cur) return false;
            var prev = null;
            while (undoStack.length) {
                var c = undoStack.pop();
                if (c.key !== cur.key) { prev = c; break; }
            }
            if (!prev) { toast('Nothing to undo', '↩️'); return false; }
            eq.restoreEQState(prev.snap);
            var after = snap();
            // `after` identifies the state this undo produced, so a later redo
            // can tell whether the EQ has been edited in between.
            redoStack.push({ snap: cur.snap, after: after ? after.key : null });
            if (redoStack.length > MAX) redoStack.shift();
            toast('Undid last EQ change', '↩️');
            return true;
        } catch (err) { console.error('[EQ undo]', err); return false; }
    }

    function redo(eq) {
        try {
            var zone = document.getElementById('eq-col-graph');
            if (!zone || zone.offsetParent === null) return false;
            var cur = snap();
            if (!cur) return false;
            var r = redoStack[redoStack.length - 1];
            if (!r || r.after !== cur.key) {
                // Edited since the undo (or nothing was undone): redo is stale.
                redoStack.length = 0;
                toast('Nothing to redo', '↪️');
                return false;
            }
            redoStack.pop();
            var top = undoStack[undoStack.length - 1];
            if (!top || top.key !== cur.key) undoStack.push(cur);
            eq.restoreEQState(r.snap);
            toast('Redid EQ change', '↪️');
            return true;
        } catch (err) { console.error('[EQ redo]', err); return false; }
    }

    // ---- remember last EQ -----------------------------------------------------
    function finite(v, lo, hi) {
        var n = typeof v === 'number' ? v : parseFloat(v);
        return Number.isFinite(n) && n >= lo && n <= hi;
    }
    // `optionalGainQ`: the advanced bank starts life with no g / q fields (only
    // hz, type and defaultQ), so those two may be absent there - but if present
    // they must still be in range.
    function validBand(b, withSlope, optionalGainQ) {
        if (!b || typeof b !== 'object') return false;
        if (!finite(b.hz, 10, 24000)) return false;
        var gOk = (optionalGainQ && (b.g === undefined || b.g === null)) || finite(b.g, -60, 60);
        var qOk = (optionalGainQ && (b.q === undefined || b.q === null)) || finite(b.q, 0.01, 50);
        if (!gOk || !qOk) return false;
        if (TYPES.indexOf(b.type) === -1) return false;
        if (withSlope && b.slope !== undefined && b.slope !== null && [12, 24, 36, 48].indexOf(Number(b.slope)) === -1) return false;
        return true;
    }
    // restoreEQState writes raw values into the advanced model and the DOM, so a
    // damaged or hand-edited entry must be rejected whole, never applied partly.
    function validSnapshot(s, eq) {
        if (!s || typeof s !== 'object') return false;
        if (!Array.isArray(s.main) || s.main.length !== eq.bands.length) return false;
        if (!Array.isArray(s.adv) || s.adv.length !== eq.advancedBands.length) return false;
        if (!Array.isArray(s.bypassed) || s.bypassed.length > 64) return false;
        if (s.preamp != null && !finite(s.preamp, -20, 20)) return false;
        for (var i = 0; i < s.main.length; i++) {
            var m = s.main[i];
            if (!m || !finite(m.hz, 10, 24000) || !finite(m.g, -20, 20) || !finite(m.q, 0.1, 10)) return false;
            if (TYPES.indexOf(m.type) === -1) return false;
            if (m.slope !== undefined && m.slope !== null && [12, 24, 36, 48].indexOf(Number(m.slope)) === -1) return false;
        }
        for (var j = 0; j < s.adv.length; j++) if (!validBand(s.adv[j], true, true)) return false;
        for (var k = 0; k < s.bypassed.length; k++) if (!/^[mav]\d{1,3}$/.test(String(s.bypassed[k]))) return false;
        if (s.virtual !== undefined) {
            if (!Array.isArray(s.virtual) || s.virtual.length > 64) return false;
            for (var v = 0; v < s.virtual.length; v++) if (!validBand(s.virtual[v], false)) return false;
        }
        return true;
    }
    function persistNow() {
        try {
            var eq = window.EQ;
            if (!restored || !eq || typeof eq.snapshotEQState !== 'function') return;
            var key = JSON.stringify(eq.snapshotEQState());
            if (key === lastSavedKey) return;
            lastSavedKey = key;
            SafeStorage.setItem(STORE_KEY, key);
        } catch (_) {}
    }
    function schedulePersist() {
        if (!restored) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(persistNow, 800);
    }
    function restoreLast(eq) {
        try {
            var raw = SafeStorage.getItem(STORE_KEY);
            if (raw) {
                var s = JSON.parse(raw);
                if (validSnapshot(s, eq)) {
                    eq.restoreEQState(s);
                    lastSavedKey = JSON.stringify(eq.snapshotEQState());
                } else {
                    console.warn('[EQ history] saved EQ failed validation; discarded.');
                    SafeStorage.removeItem(STORE_KEY);
                }
            }
        } catch (err) {
            console.warn('[EQ history] could not restore saved EQ:', err);
            try { SafeStorage.removeItem(STORE_KEY); } catch (_) {}
        } finally {
            restored = true;
        }
    }

    document.addEventListener('pointerdown', record, true);
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key && e.key.indexOf('Arrow') === 0) record(e);
    }, true);
    ['pointerup', 'keyup', 'input', 'change'].forEach(function (ev) {
        document.addEventListener(ev, function (e) {
            var t = e.target;
            if (t && t.closest && t.closest(ZONES)) schedulePersist();
        }, true);
    });
    // Programmatic changes (AutoEQ results, presets) can land after the gesture
    // that started them, so also flush when the window is hidden or closing.
    window.addEventListener('pagehide', persistNow);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') persistNow();
    });

    return { undo: undo, redo: redo, restoreLast: restoreLast, persistNow: persistNow, STORE_KEY: STORE_KEY };
})();

const EQ_HistoryMethods = {
    undoEQ: function () { return EQ_History.undo(this); },
    redoEQ: function () { return EQ_History.redo(this); }
};
