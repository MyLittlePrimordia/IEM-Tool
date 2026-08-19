const localStorageBackup = window.localStorage;

const SafeStorage = {
    memoryStorage: {},
    isSupported: function() {
        try {
            localStorageBackup.setItem('__storage_test__', 'test');
            localStorageBackup.removeItem('__storage_test__');
            return true;
        } catch (e) {
            return false;
        }
    }(),
    getItem: function(key) {
        // Memory is the most recent write attempt: a value stored in memory
        // (after a quota failure) must shadow the older value still on disk,
        // otherwise an in-session write would silently read back as stale.
        if (this.memoryStorage.hasOwnProperty(key)) return this.memoryStorage[key];
        if (this.isSupported) {
            try {
                return localStorageBackup.getItem(key);
            } catch (e) {
                console.warn("[SafeStorage] Read failed.", e);
                return null;
            }
        }
        return null;
    },
    setItem: function(key, value) {
        if (this.isSupported) {
            try {
                localStorageBackup.setItem(key, value);
                // Persisted on disk: drop any older in-memory copy so the disk
                // value stays the source of truth and memory cannot shadow it.
                delete this.memoryStorage[key];
                return;
            } catch (e) {
                // Quota/private-mode failures: keep the value in memory so a
                // later read still returns it for this session instead of the
                // caller silently losing the write (the preset would vanish
                // on the next page load regardless, but in-session behavior
                // must not lie about the save).
                console.warn("[SafeStorage] Write limit exceeded; keeping value in memory.", e);
            }
        }
        this.memoryStorage[key] = String(value);
    },
    removeItem: function(key) {
        if (this.isSupported) {
            try {
                localStorageBackup.removeItem(key);
            } catch (e) {
                console.warn("[SafeStorage] Remove failed.", e);
            }
        }
        delete this.memoryStorage[key];
    },
    clear: function() {
        if (this.isSupported) {
            try {
                localStorageBackup.clear();
            } catch (e) {
                console.warn("[SafeStorage] Clear failed.", e);
            }
        }
        this.memoryStorage = {};
    }
};

// Route the global `localStorage` through SafeStorage everywhere, not just
// when the browser lacks storage support. Every existing call site in the
// app (theme/font settings, taste-matcher favorites, canonical-profile
// cache, etc.) uses the bare global `localStorage.getItem/setItem`, so this
// is what actually makes SafeStorage's quota/private-mode fallback reach
// those call sites instead of protecting only code that explicitly calls
// `SafeStorage.*` directly.
Object.defineProperty(window, 'localStorage', {
    get: function() {
        return SafeStorage;
    }
});
