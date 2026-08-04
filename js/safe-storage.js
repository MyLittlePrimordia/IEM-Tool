// ==========================================================================
// safe-storage.js — SafeStorage: fail-safe localStorage wrapper (falls back to
// an in-memory object if localStorage is unavailable/blocked/full) plus the
// window.localStorage override that transparently routes all existing
// `localStorage.getItem/setItem/...` call sites through it. Extracted
// verbatim from the monolithic inline script (audit #4, fourth slice).
//
// Zero dependency on any other app module -- confirmed by grep before
// extracting (no reference to PEQDB_Module, App, EQ_Module, FindEngine,
// IEM_Module, Tone_Module, CurveUtils, SharedAudio, Accessibility, or
// showToast anywhere in this block). It only touches window/localStorage.
//
// Load-order matters here more than for the previous three slices: this file
// MUST load before anything else that touches `localStorage` (including the
// one-time theme-id migration IIFE still inline in the main script, and every
// module further down that reads/writes settings, presets, etc.), because the
// Object.defineProperty override below is what makes window.localStorage
// resolve to this fail-safe wrapper everywhere else in the app. It's placed
// in <head> immediately after accessibility.js for exactly that reason.
//
// Still a plain global (not an ES module) for the same reason as the other
// three slices: nothing about the extraction changes behavior or identifiers,
// it only moves the code to its own file/network request.
// ==========================================================================
// ==========================================
// SAFE LOCALSTORAGE FAIL-SAFE WRAPPER
// ==========================================
const SafeStorage = {
    memoryStorage: {},
    isSupported: function() {
        try {
            localStorage.setItem('__storage_test__', 'test');
            localStorage.removeItem('__storage_test__');
            return true;
        } catch (e) {
            return false;
        }
    }(),
    getItem: function(key) {
        if (this.isSupported) return localStorage.getItem(key);
        return this.memoryStorage.hasOwnProperty(key) ? this.memoryStorage[key] : null;
    },
    setItem: function(key, value) {
        if (this.isSupported) {
            try {
                localStorage.setItem(key, value);
            } catch (e) {
                console.warn("[SafeStorage] Write limit exceeded.");
            }
        } else {
            this.memoryStorage[key] = String(value);
        }
    },
    removeItem: function(key) {
        if (this.isSupported) localStorage.removeItem(key);
        else delete this.memoryStorage[key];
    },
    clear: function() {
        if (this.isSupported) localStorage.clear();
        else this.memoryStorage = {};
    }
};

// Global override to protect existing references
const localStorageBackup = window.localStorage;
Object.defineProperty(window, 'localStorage', {
    get: function() {
        return SafeStorage.isSupported ? localStorageBackup : SafeStorage;
    }
});
