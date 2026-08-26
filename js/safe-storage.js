const localStorageBackup = (() => {
    try {
        return (typeof window !== 'undefined') ? window.localStorage : null;
    } catch (_) {
        return null;
    }
})();

const SafeStorage = {
    memoryStorage: {},
    _memoryBytes: 0,
    _memoryOrder: [],
    MAX_MEMORY_KEYS: 200,
    MAX_MEMORY_BYTES: 2 * 1024 * 1024,
    _sizeOf: function(k, v) { return (String(k).length + String(v).length) * 2; },
    _evictIfNeeded: function() {
        while (this._memoryOrder.length > this.MAX_MEMORY_KEYS || this._memoryBytes > this.MAX_MEMORY_BYTES) {
            const oldest = this._memoryOrder.shift();
            if (oldest && this.memoryStorage.hasOwnProperty(oldest)) {
                this._memoryBytes -= this._sizeOf(oldest, this.memoryStorage[oldest]);
                if (this._memoryBytes < 0) this._memoryBytes = 0;
                delete this.memoryStorage[oldest];
            } else if (!oldest) break;
        }
    },
    isSupported: function() {
        try {
            if (!localStorageBackup) return false;
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
        if (this.memoryStorage.hasOwnProperty(key)) {
            // Refresh recency so eviction (oldest-first) is LRU by use,
            // not FIFO by write order.
            const idx = this._memoryOrder.indexOf(key);
            if (idx !== -1 && idx !== this._memoryOrder.length - 1) {
                this._memoryOrder.splice(idx, 1);
                this._memoryOrder.push(key);
            }
            return this.memoryStorage[key];
        }
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
                if (this.memoryStorage.hasOwnProperty(key)) {
                    this._memoryBytes -= this._sizeOf(key, this.memoryStorage[key]);
                    const idx = this._memoryOrder.indexOf(key);
                    if (idx !== -1) this._memoryOrder.splice(idx, 1);
                    delete this.memoryStorage[key];
                    if (this._memoryBytes < 0) this._memoryBytes = 0;
                }
                return;
            } catch (e) {
                // QuotaExceededError (Safari/Firefox) and SecurityError (private mode)
                // both mean further disk probes will keep failing — stop hammering
                // and fall through to the in-memory fallback for this session.
                const isQuota = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
                const isSecurity = e && e.name === 'SecurityError';
                if (isSecurity || isQuota) this.isSupported = false;
                console.warn("[SafeStorage] Write limit exceeded; keeping value in memory.", e);
                try { if (typeof showToast === 'function') showToast("Storage full — saved for this session only (will reset on reload).", "⚠️", { duration: 3500 }); } catch (_) {}
            }
        }
        const strVal = String(value);
        if (this.memoryStorage.hasOwnProperty(key)) {
            this._memoryBytes -= this._sizeOf(key, this.memoryStorage[key]);
            const idx = this._memoryOrder.indexOf(key);
            if (idx !== -1) this._memoryOrder.splice(idx, 1);
        }
        this.memoryStorage[key] = strVal;
        this._memoryBytes += this._sizeOf(key, strVal);
        this._memoryOrder.push(key);
        this._evictIfNeeded();
    },
    removeItem: function(key) {
        if (this.isSupported) {
            try {
                localStorageBackup.removeItem(key);
            } catch (e) {
                console.warn("[SafeStorage] Remove failed.", e);
            }
        }
        if (this.memoryStorage.hasOwnProperty(key)) {
            this._memoryBytes -= this._sizeOf(key, this.memoryStorage[key]);
            const idx = this._memoryOrder.indexOf(key);
            if (idx !== -1) this._memoryOrder.splice(idx, 1);
            delete this.memoryStorage[key];
            if (this._memoryBytes < 0) this._memoryBytes = 0;
        }
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
        this._memoryBytes = 0;
        this._memoryOrder = [];
    },
    key: function(n) {
        try {
            const keys = new Set();
            if (this.isSupported) {
                try {
                    for (let i = 0; i < localStorageBackup.length; i++) {
                        const k = localStorageBackup.key(i);
                        if (k != null) keys.add(k);
                    }
                } catch (_) {}
            }
            Object.keys(this.memoryStorage).forEach(k => keys.add(k));
            const arr = Array.from(keys);
            return arr[n] || null;
        } catch (_) { return null; }
    },
    get length() {
        try {
            const keys = new Set();
            if (this.isSupported) {
                try {
                    for (let i = 0; i < localStorageBackup.length; i++) {
                        const k = localStorageBackup.key(i);
                        if (k != null) keys.add(k);
                    }
                } catch (_) {}
            }
            Object.keys(this.memoryStorage).forEach(k => keys.add(k));
            return keys.size;
        } catch (_) { return Object.keys(this.memoryStorage).length; }
    }
};

// Route the global `localStorage` through SafeStorage everywhere, not just
// when the browser lacks storage support. Every existing call site in the
// app (theme/font settings, taste-matcher favorites, canonical-profile
// cache, etc.) uses the bare global `localStorage.getItem/setItem`, so this
// is what actually makes SafeStorage's quota/private-mode fallback reach
// those call sites instead of protecting only code that explicitly calls
// `SafeStorage.*` directly.
const SafeStorageProxy = (typeof Proxy !== 'undefined') ? new Proxy(SafeStorage, {
    get(target, prop, receiver) {
        if (prop in target) {
            const v = target[prop];
            return typeof v === 'function' ? v.bind(target) : v;
        }
        if (typeof prop === 'string') {
            const stored = target.getItem(prop);
            if (stored !== null) return stored;
        }
        return undefined;
    },
    set(target, prop, value) {
        if (prop in target) { target[prop] = value; return true; }
        if (typeof prop === 'string') { target.setItem(prop, String(value)); return true; }
        return false;
    },
    has(target, prop) {
        if (prop in target) return true;
        if (typeof prop === 'string') return target.getItem(prop) !== null;
        return false;
    },
    deleteProperty(target, prop) {
        if (typeof prop === 'string') target.removeItem(prop);
        return true;
    },
    ownKeys(target) {
        try {
            const keys = new Set();
            if (target.isSupported) {
                try { for (let i = 0; i < localStorageBackup.length; i++) { const k = localStorageBackup.key(i); if (k) keys.add(k); } } catch (_) {}
            }
            Object.keys(target.memoryStorage).forEach(k => keys.add(k));
            // A stored key that happens to collide with one of SafeStorage's
            // own property names (e.g. a caller doing localStorage.setItem
            // ('length', ...)) would otherwise appear twice here, which
            // violates the Proxy ownKeys invariant and throws
            // "TypeError: 'ownKeys' on proxy: trap returned duplicate
            // entries" on the next Object.keys()/for...in over localStorage.
            Object.getOwnPropertyNames(target).forEach(k => keys.add(k));
            return Array.from(keys);
        } catch (_) { return Object.getOwnPropertyNames(target); }
    },
    getOwnPropertyDescriptor(target, prop) {
        if (prop in target) return Object.getOwnPropertyDescriptor(target, prop);
        if (typeof prop === 'string') {
            const val = target.getItem(prop);
            if (val !== null) return { configurable: true, enumerable: true, value: val, writable: true };
        }
        return undefined;
    }
}) : SafeStorage;

Object.defineProperty(window, 'localStorage', {
    get: function() {
        return SafeStorageProxy;
    },
    set: function(v) {
        // Allow libraries that assign to localStorage to not throw in strict mode;
        // keep SafeStorage as the effective store.
        try { if (v && typeof v.setItem === 'function') SafeStorage.memoryStorage = v; } catch (_) {}
    },
    configurable: true
});
