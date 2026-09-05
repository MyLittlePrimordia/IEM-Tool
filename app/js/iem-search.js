const IemSearchIndex = {
    _index: null,
    _db: null,
    _tokenizer: null,
    _initialized: false,

    init: function(db) {
        this._db = db || [];
        this._buildIndex();
        this._initialized = true;
    },

    _tokenizer: function(text) {
        if (!text) return [];
        return text.toLowerCase()
            .split(/[\s\-_\/\(\)\[\]\{\}\|;:,.]+/)
            .filter(t => t.length > 0);
    },

    _buildIndex: function() {
        const index = new Map();
        const db = this._db;

        for (let i = 0; i < db.length; i++) {
            const item = db[i];
            if (!item) continue;

            const tokens = new Set();
            const brand = item.brand || '';
            const model = item.model || '';
            const variant = item.variant || '';
            const name = item.name || '';
            const tags = Array.isArray(item.tags) ? item.tags : [];
            const source = item.source || '';

            // Tokenize all searchable fields (tags go through the same
            // tokenizer as queries so multiword tags like "sub-bass" match
            // token queries ["sub","bass"] instead of missing wholesale)
            [brand, model, variant, name, source].forEach(field => {
                this._tokenizer(field).forEach(t => tokens.add(t));
            });
            tags.forEach(tag => this._tokenizer(tag).forEach(t => tokens.add(t)));

            // Prefix + suffix n-grams for partial matching ("moon" and
            // "drop" both match "moondrop"; pure-prefix missed the latter)
            [brand, model, variant, name].forEach(field => {
                const words = this._tokenizer(field);
                words.forEach(w => {
                    if (w.length >= 3) {
                        for (let len = 3; len <= w.length; len++) {
                            tokens.add(w.substring(0, len));
                            tokens.add(w.substring(w.length - len));
                        }
                    }
                });
            });

            tokens.forEach(token => {
                if (!index.has(token)) index.set(token, new Set());
                index.get(token).add(item.id);
            });
        }

        this._index = index;
    },

    search: function(query) {
        if (!this._initialized) return [];
        if (!query || !query.trim()) return this._db;

        const tokens = this._tokenizer(query);
        if (tokens.length === 0) return this._db;

        let candidateIds = null;
        let allMatched = true;

        for (const token of tokens) {
            const ids = this._index.get(token);
            if (!ids || ids.size === 0) {
                allMatched = false;
                break; // Fall through to OR-ranked fallback below
            }
            if (candidateIds === null) {
                candidateIds = new Set(ids);
            } else {
                // Intersect with previous candidates
                for (const id of candidateIds) {
                    if (!ids.has(id)) candidateIds.delete(id);
                }
                if (candidateIds.size === 0) { allMatched = false; break; }
            }
        }

        if (allMatched && candidateIds) {
            // Exact AND match — return full items in original order
            const results = [];
            for (const item of this._db) {
                if (candidateIds.has(item.id)) results.push(item);
            }
            return results;
        }

        // OR fallback: a single typo/unknown token previously zeroed the
        // result set. Rank by tokens-matched (desc), keep DB order on ties.
        const hitCount = new Map();
        for (const token of tokens) {
            const ids = this._index.get(token);
            if (!ids) continue;
            for (const id of ids) hitCount.set(id, (hitCount.get(id) || 0) + 1);
        }
        if (hitCount.size === 0) return [];
        const results = [];
        for (const item of this._db) {
            if (hitCount.has(item.id)) results.push({ item, hits: hitCount.get(item.id) });
        }
        results.sort((a, b) => b.hits - a.hits);
        return results.map(r => r.item);
    },

    getDb: function() {
        return this._db;
    },

    rebuild: function(db) {
        this.init(db);
    }
};

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = IemSearchIndex;
} else {
    window.IemSearchIndex = IemSearchIndex;
}