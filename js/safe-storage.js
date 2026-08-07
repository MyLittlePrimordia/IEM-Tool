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
                // Quota/private-mode failures: keep the value in memory so a
                // later read still returns it for this session instead of the
                // caller silently losing the write (the preset would vanish
                // on the next page load regardless, but in-session behavior
                // must not lie about the save).
                console.warn("[SafeStorage] Write limit exceeded; keeping value in memory.", e);
                this.memoryStorage[key] = String(value);
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

const localStorageBackup = window.localStorage;
Object.defineProperty(window, 'localStorage', {
    get: function() {
        return SafeStorage.isSupported ? localStorageBackup : SafeStorage;
    }
});
