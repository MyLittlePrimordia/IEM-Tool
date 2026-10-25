// Source-aware measurement helpers.
//
// The catalogue links every product to one or more measurement files, each
// living in a folder named after the person/site that published it. Before
// this module the app only ever loaded files[0] and showed a single score with
// no indication that 2,000+ products have several, sometimes wildly different,
// measurements. This provides:
//
//   * path -> { source, file, condition, isMod } parsing
//   * a decoded consensus curve from catalogue-index.json (precomputed at
//     build time, see scripts/build-catalogue-index.mjs)
//   * on-demand loading of every source curve for the explorer
//
// The index file is optional: if it is missing (a user edited database.json
// without rebuilding) every helper degrades to the old single-curve behaviour.
const SourceIndex = {
    VERSION: 1,
    GRID_POINTS: 100,
    data: null,
    loadPromise: null,

    // A-008: who measured what.
    //
    // Every folder under data/ is a different person, publication or archive.
    // The catalogue only preserved the folder name, so the app could plot 2,000
    // products without ever naming the people who measured them. This table is
    // keyed by that exact folder name and was resolved against Squiglink's own
    // public source registry (squigsites.json), with the ten off-platform and
    // legacy collections linked to their publishers directly. All links are
    // HTTPS and are also allowlisted in main.js before the OS opens them.
    //
    // `kind` is presentation only: "squig" means the source publishes a
    // Squiglink database, "web" means their measurements live on their own site
    // or archive. Keep this table in sync with data/ - test-source-credits.mjs
    // fails when a folder has no attribution.
    CREDITS: {
        "ACHO REVIEWS": { label: "Acho Reviews", url: "https://achoreviews.squig.link/", kind: "squig" },
        "ADEN": { label: "aden", url: "https://aden.squig.link/", kind: "squig" },
        "ADRI-N": { label: "Adri-N", url: "https://adri-n.squig.link/", kind: "squig" },
        "AFTERSOUND": { label: "Aftersound", url: "https://aftersound.squig.link/", kind: "squig" },
        "ANIMAGUS": { label: "Animagus", url: "https://animagus.squig.link/", kind: "squig" },
        "ATECHREVIEWS": { label: "ATechReviews", url: "https://atechreviews.squig.link/", kind: "squig" },
        "AUDIOAI": { label: "audioAI", url: "https://arn.squig.link/", kind: "squig" },
        "AUDIOAMIGO": { label: "Audio Amigo", url: "https://audioamigo.squig.link/", kind: "squig" },
        "AURICULARES ARGENTINA": { label: "Auriculares Argentina", url: "https://auricularesargentina.squig.link/", kind: "squig" },
        "AVISHAI": { label: "avishai", url: "https://squig.link/lab/avishai/", kind: "squig" },
        "BAKKWATAN": { label: "Bakkwatan", url: "https://bakkwatan.squig.link/", kind: "squig" },
        "BANZAI1122": { label: "banzai1122", url: "https://banzai1122.squig.link/", kind: "squig" },
        "BASS AUDIO": { label: "Bass Audio", url: "https://bassaudio.squig.link/", kind: "squig" },
        "BASSY ALEXANDER": { label: "bassy Alexander", url: "https://bassyalexander.squig.link/", kind: "squig" },
        "BEDROCK REVIEWS": { label: "Bedrock Reviews", url: "https://bedrock.squig.link/", kind: "squig" },
        "BLOOM AUDIO": { label: "Bloom Audio", url: "https://bloomaudio.squig.link/", kind: "squig" },
        "BOIZOFF": { label: "boizoff", url: "https://boizoff.squig.link/", kind: "squig" },
        "BREAMPIKE": { label: "breampike", url: "https://breampike.squig.link/", kind: "squig" },
        "BUKANAUDIOPHILE": { label: "BukanAudiophile", url: "https://bukanaudiophile.squig.link/", kind: "squig" },
        "CAMMYFI": { label: "CammyFi", url: "https://cammyfi.squig.link/", kind: "squig" },
        "CAPRA AUDIO": { label: "Capra Audio", url: "https://capraaudio.squig.link/", kind: "squig" },
        "CSI-ZONE": { label: "CSI-ZONE", url: "https://csi-zone.squig.link/", kind: "squig" },
        "DCHPGALL": { label: "DCinside Headphone Gallery", url: "https://dchpgall.squig.link/", kind: "squig" },
        "DCINSIDE": { label: "DCinside Headphone Gallery", url: "https://dchpgall.squig.link/", kind: "squig" },
        "DEN-FI": { label: "Den-Fi (Kyle)", url: "https://ish.squig.link/", kind: "squig" },
        "DHRME": { label: "DHRME", url: "https://dhrme.squig.link/", kind: "squig" },
        "DIGAO REVIEWS": { label: "Digão Reviews", url: "https://digaoreviews.squig.link/", kind: "squig" },
        "DUCBLOKE": { label: "DucBloke", url: "https://ducbloke.squig.link/", kind: "squig" },
        "DUNG LE": { label: "Dung Le", url: "https://dl.squig.link/", kind: "squig" },
        "EARPHONES ARCHIVE": { label: "Earphones Archive (IEMs)", url: "https://earphonesarchive.squig.link/", kind: "squig" },
        "EKAUDIO": { label: "EKaudio", url: "https://ekaudio.squig.link/", kind: "squig" },
        "ELISE AUDIO": { label: "Elise Audio", url: "https://eliseaudio.squig.link/", kind: "squig" },
        "ELRICS": { label: "Elrics", url: "https://squig.link/lab/elrics/", kind: "squig" },
        "ENEMYSPIDER": { label: "EnemySpider", url: "https://enemyspider.squig.link/", kind: "squig" },
        "ENIGMAFOTOSREVIEWS": { label: "Enigma Fotos Reviews", url: "https://enigmafotosreviews.squig.link/", kind: "squig" },
        "EPLV": { label: "EPLV", url: "https://eplv.squig.link/", kind: "squig" },
        "FAHRYST": { label: "Fahryst", url: "https://fahryst.squig.link/", kind: "squig" },
        "FAXEPREMIUM": { label: "faxepremium", url: "https://faxepremium.squig.link/", kind: "squig" },
        "FERNANDA GUNSAN": { label: "Fernanda Gunsan", url: "https://squig.link/lab/fernandagunsan/", kind: "squig" },
        "FILK": { label: "Filk", url: "https://filk.squig.link/", kind: "squig" },
        "FLARE": { label: "Flare", url: "https://flare.squig.link/", kind: "squig" },
        "FOX TOLD ME SO": { label: "Fox Told Me So (IEMs)", url: "https://foxtoldmeso.squig.link/", kind: "squig" },
        "FREERYDER05": { label: "freeryder05", url: "https://freeryder05.squig.link/", kind: "squig" },
        "GADGET GENERATIONS": { label: "Gadget Generations", url: "https://gadgetgenerations.squig.link/", kind: "squig" },
        "GADGETRY TECH": { label: "Gadgetry Tech", url: "https://gadgetrytech.squig.link/", kind: "squig" },
        "HADOE": { label: "Hadoe", url: "https://hadoe.squig.link/", kind: "squig" },
        "HANA": { label: "Hana", url: "https://squig.link/lab/hana/", kind: "squig" },
        "HANGOUT.AUDIO": { label: "Hangout.Audio", url: "https://hangout.audio/", kind: "squig" },
        "HARPO": { label: "Harpo", url: "https://harpo.squig.link/", kind: "squig" },
        "HARUTOHIROKI": { label: "HarutoHiroki", url: "https://squig.link/lab/harutohiroki/", kind: "squig" },
        "HAWAII BAY BOY": { label: "Hawaii Bad Boy (HBB)", url: "https://hbb.squig.link/", kind: "squig" },
        "HEADPHONE.COM LEGACY": { label: "Headphones.com (legacy)", url: "https://headphones.com/pages/measurements-and-frequency-response", kind: "web" },
        "HEADPIE": { label: "Headpie", url: "https://www.headpie.net/", kind: "web" },
        "HI END PORTABLE": { label: "Hi End Portable", url: "https://cqtek.squig.link/", kind: "squig" },
        "HOBBY TALK": { label: "Hobby Talk", url: "https://hobbytalk.squig.link/", kind: "squig" },
        "HORE": { label: "Hore", url: "https://hore.squig.link/", kind: "squig" },
        "HU-FI": { label: "Hu-Fi", url: "https://hu-fi.squig.link/", kind: "squig" },
        "HYPETHESONICS": { label: "Hypethesonics", url: "https://www.hypethesonics.com/", kind: "web" },
        "IANFANN": { label: "ianfann", url: "https://ianfann.squig.link/", kind: "squig" },
        "IEM OCEAN": { label: "IEM Ocean", url: "https://iemocean.squig.link/", kind: "squig" },
        "IEM WORLD": { label: "IEM World", url: "https://iemworld.squig.link/", kind: "squig" },
        "INNERFIDELITY": { label: "InnerFidelity (Tyll Hertsens archive)", url: "https://www.stereophile.com/content/innerfidelity-headphone-measurements", kind: "web" },
        "ISAIAH SE": { label: "Isaiah SE", url: "https://isaiahse.squig.link/", kind: "squig" },
        "JACSTONE": { label: "Jacstone", url: "https://jacstone.squig.link/", kind: "squig" },
        "JAY'S AUDIO": { label: "Jay's Audio", url: "https://jaysaudio.github.io/", kind: "web" },
        "JAYTISS": { label: "Jaytiss", url: "https://jaytiss.squig.link/", kind: "squig" },
        "JOYCES REVIEW": { label: "Joyce's Review", url: "https://squig.link/lab/joycesreview/", kind: "squig" },
        "KAZI": { label: "Kazi", url: "https://kazi.squig.link/", kind: "squig" },
        "KOI": { label: "KOI", url: "https://squig.link/lab/koi/", kind: "squig" },
        "KR0MKA": { label: "kr0mka", url: "https://kr0mka.squig.link/", kind: "squig" },
        "KUPING SENSI": { label: "Kuping Sensi", url: "https://kuping-sensi.squig.link/", kind: "squig" },
        "KUULOKENURKKA": { label: "Kuulokenurkka", url: "https://kuulokenurkka.squig.link/", kind: "squig" },
        "LISTENER": { label: "listener", url: "https://listener.squig.link/", kind: "squig" },
        "LOWN-FI": { label: "lown-fi", url: "https://lown-fi.squig.link/", kind: "squig" },
        "MELATONIN": { label: "Melatonin", url: "https://melatonin.squig.link/", kind: "squig" },
        "MUSICAFE": { label: "MusiCafé", url: "https://musicafe.squig.link/", kind: "squig" },
        "NYMZ": { label: "nymz", url: "https://nymz.squig.link/", kind: "squig" },
        "ORATORY1990": { label: "oratory1990", url: "https://www.reddit.com/user/oratory1990/", kind: "web" },
        "PAUL WASABII": { label: "Paul Wasabi", url: "https://pw.squig.link/", kind: "squig" },
        "PRACTIPHILE": { label: "Practiphile", url: "https://practiphile.squig.link/", kind: "squig" },
        "PRECOGVISION": { label: "Precogvision", url: "https://precog.squig.link/", kind: "squig" },
        "RECODE": { label: "Recode", url: "https://recode.squig.link/", kind: "squig" },
        "REGAN CIPHER": { label: "Regan Cipher", url: "https://regancipher.squig.link/", kind: "squig" },
        "RIKUDOUGOKU": { label: "RikudouGoku", url: "https://rg.squig.link/", kind: "squig" },
        "RIZ": { label: "Riz", url: "https://riz.squig.link/", kind: "squig" },
        "RTINGS": { label: "RTINGS.com", url: "https://www.rtings.com/headphones", kind: "web" },
        "SCBOY": { label: "SCBoy", url: "https://scboy.squig.link/", kind: "squig" },
        "SEAN WEE": { label: "Sean Wee", url: "https://seanwee.squig.link/", kind: "squig" },
        "SIDE SALAD AUDIO": { label: "Side Salad Audio", url: "https://suporsalad.squig.link/", kind: "squig" },
        "SILICAGEL": { label: "SilicaGel", url: "https://silicagel.squig.link/", kind: "squig" },
        "SL0THE": { label: "sl0the", url: "https://sl0the.squig.link/", kind: "squig" },
        "SOUNDCHECK39": { label: "Soundcheck39", url: "https://soundcheck39.squig.link/", kind: "squig" },
        "SOUNDIGNITY": { label: "Soundignity", url: "https://soundignity.squig.link/", kind: "squig" },
        "SQUIGLINK": { label: "Squiglink", url: "https://squig.link/", kind: "squig" },
        "SUPER REVIEW": { label: "Super* Review", url: "https://squig.link/", kind: "squig" },
        "TAKEITSLOW7": { label: "takeitslow7", url: "https://takeitslow7.squig.link/", kind: "squig" },
        "TDL": { label: "TDL", url: "https://squig.link/lab/tdl/", kind: "squig" },
        "TED'S SQUIG HOARD": { label: "Ted's Squig Hoard", url: "https://tedthepraimortis.squig.link/", kind: "squig" },
        "TGX78": { label: "tgx78", url: "https://tgx78.squig.link/", kind: "squig" },
        "THE AUDIO STORE": { label: "The Audio Store", url: "https://theaudiostore.squig.link/", kind: "squig" },
        "THEMATTYB": { label: "themattyb", url: "https://www.head-fi.org/showcase/authors/themattyb.595255/reviews", kind: "web" },
        "THEROLLO9": { label: "therollo9", url: "https://therollo9.squig.link/", kind: "squig" },
        "TIMTUNED": { label: "TimTuned", url: "https://timmyv.squig.link/", kind: "squig" },
        "TONEDEAFMONK": { label: "ToneDeafMonk", url: "https://tonedeafmonk.squig.link/", kind: "squig" },
        "UNHEARD LAB": { label: "Unheard Lab", url: "https://sai.squig.link/", kind: "squig" },
        "VORTEX REVIEWS": { label: "Vortex Reviews", url: "https://vortexreviews.squig.link/", kind: "squig" },
        "VSG": { label: "VSG", url: "https://vsg.squig.link/", kind: "squig" },
        "YOSHI ULTRA": { label: "yoshi ultra", url: "https://yoshiultra.squig.link/", kind: "squig" },
    },

    // Non-catalogue aliases (old saved paths, imported presets). Catalogue
    // folders are labelled from CREDITS above, so adding a source to data/
    // needs one credit entry rather than two.
    LABELS: {
        'AUDIOAMIGO': 'Audio Amigo',
        'CRINACLE': 'Crinacle',
        'CRINACLE_5128': 'Crinacle (5128)',
        'SUPER_REVIEW': 'Super Review',
        'SUPERREVIEW': 'Super Review',
        'HBB': 'HBB',
        'BADGUYGOODGUYAUDIO': 'Bad Guy Good Audio',
        'GIZAUDIO': 'Gizaudio',
        'JAYS_AUDIO': 'Jays Audio',
        'FRESH_REVIEWS': 'Fresh Reviews',
        'AKROS': 'Akros',
        'DUCBLOKE': 'Ducbloke',
        'SEE_AUDIO': 'SeeAudio',
        'DIVINUS': 'Divinus',
        'Z_REVIEWS': 'Z Reviews',
        'SQUIGLINK': 'Squiglink'
    },

    _prettyName: function (raw) {
        return String(raw || '')
            .replace(/[_\-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
            .join(' ');
    },

    sourceLabel: function (source) {
        const key = String(source || '').trim();
        if (!key) return 'Unknown source';
        const credit = this.creditFor(key);
        if (credit) return credit.label;
        if (this.LABELS[key]) return this.LABELS[key];
        const upper = key.toUpperCase();
        if (this.LABELS[upper]) return this.LABELS[upper];
        return this._prettyName(key);
    },

    // Credit row for a data/ folder name. Matching is exact first, then
    // case-insensitive: catalogue paths use the folder spelling, while saved
    // reviews can carry a differently-cased source from an older database.
    creditFor: function (source) {
        const key = String(source || '').trim();
        if (!key) return null;
        if (this.CREDITS[key]) return this.CREDITS[key];
        const upper = key.toUpperCase();
        return this.CREDITS[upper] || null;
    },

    // Unique publishers, not folders: DCINSIDE and DCHPGALL are two archive
    // folders from the same Korean gallery and must not appear twice in the
    // credits panel. `folders` keeps the link back to the raw paths.
    creditList: function () {
        const byUrl = new Map();
        Object.keys(this.CREDITS).forEach((folder) => {
            const credit = this.CREDITS[folder];
            if (!credit || !credit.url) return;
            const existing = byUrl.get(credit.url);
            if (existing) {
                if (existing.folders.indexOf(folder) === -1) existing.folders.push(folder);
                return;
            }
            byUrl.set(credit.url, {
                label: credit.label,
                url: credit.url,
                kind: credit.kind || 'web',
                folders: [folder]
            });
        });
        return Array.from(byUrl.values()).sort((a, b) => a.label.localeCompare(b.label));
    },

    kindLabel: function (kind) {
        return kind === 'squig' ? 'Squiglink database' : 'Published archive';
    },

    // data/<SOURCE>/<FILE>.txt
    parsePath: function (filePath) {
        const raw = String(filePath || '').replace(/\\/g, '/');
        const parts = raw.split('/').filter(Boolean);
        const file = parts.length ? parts[parts.length - 1] : '';
        const source = parts.length >= 2 ? parts[parts.length - 2] : '';
        const fileName = file.replace(/\.[^.]+$/, '');
        const lower = fileName.toLowerCase();
        const condition = /(\d+\s*(?:ohm|Ω)|adapter|impedance|foam|mod\b|tape|vent|nozzle|filter|mesh|damper|tanya|switch|sample|tips?)/.test(lower)
            ? fileName
            : '';
        const isMod = !!condition;
        return { source, file: fileName, condition, isMod };
    },

    // Short condition tag for a badge: "200Ω", "nozzle mod", "foam tips".
    conditionLabel: function (filePath) {
        const p = this.parsePath(filePath);
        if (!p.condition) return '';
        const lower = p.file.toLowerCase();
        const ohm = lower.match(/(\d+)\s*(?:ohm|Ω)/);
        if (ohm) return `${ohm[1]}Ω`;
        if (/foam/.test(lower)) return 'foam tips';
        if (/nozzle/.test(lower)) return 'nozzle mod';
        if (/filter/.test(lower)) return 'filter mod';
        if (/tape|mesh|damper|tanya/.test(lower)) return 'mesh mod';
        if (/adapter|impedance/.test(lower)) return 'adapter';
        if (/vent/.test(lower)) return 'vent mod';
        return 'variant';
    },

    load: function () {
        if (this.loadPromise) return this.loadPromise;
        this.loadPromise = (async () => {
            const tryFetch = async (url) => {
                try {
                    const res = await fetch(url, { cache: 'no-store' });
                    if (!res.ok) return null;
                    if (url.endsWith('.gz')) {
                        if (typeof DecompressionStream === 'undefined') return null;
                        return await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).json();
                    }
                    return await res.json();
                } catch (e) {
                    return null;
                }
            };
            let parsed = await tryFetch('./catalogue-index.json');
            if (!parsed) parsed = await tryFetch('./catalogue-index.json.gz');
            if (!parsed || !parsed.entries || typeof parsed.entries !== 'object') {
                console.warn('[SourceIndex] catalogue-index.json missing or invalid; using single-curve mode.');
                this.data = null;
                return null;
            }
            this.data = parsed;
            return parsed;
        })().catch(err => {
            console.warn('[SourceIndex] index load failed:', err);
            this.data = null;
            return null;
        });
        return this.loadPromise;
    },

    entryFor: function (id) {
        if (!this.data || !this.data.entries) return null;
        return this.data.entries[id] || null;
    },

    _decodeBase64: function (b64) {
        if (typeof atob !== 'function') return null;
        try {
            const bin = atob(b64);
            const out = new Float32Array(bin.length);
            for (let i = 0; i < bin.length; i++) {
                let v = bin.charCodeAt(i);
                if (v > 127) v -= 256;
                out[i] = 75 + v / 4;
            }
            return out;
        } catch (e) {
            return null;
        }
    },

    decodeConsensus: function (entry) {
        if (!entry || !entry.q) return null;
        if (entry._decoded) return entry._decoded;
        const arr = this._decodeBase64(entry.q);
        if (!arr) return null;
        entry._decoded = arr;
        return arr;
    },

    grid: function () {
        return CurveUtils.generateLogGrid(this.GRID_POINTS);
    },

    // Attach precomputed metadata to the dataset items CurveIndexer builds.
    attachToDataset: function (items) {
        if (!Array.isArray(items)) return items;
        if (!this.data) return items;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || item.id == null) continue;
            const entry = this.entryFor(item.id);
            if (!entry) continue;
            item.consensus = this.decodeConsensus(entry);
            item.consensusSpread = Number.isFinite(entry.s) ? entry.s : 0;
            item.sourceCount = Number.isFinite(entry.n) ? entry.n : (Array.isArray(item.files) ? item.files.length : 1);
            item.consensusMeasured = entry.m || 0;
        }
        return items;
    },

    // Load every file linked to one product and return normalized curves.
    // Used only by the explorer / source picker, never by a full-catalogue scan.
    loadSourceCurves: async function (item) {
        if (!item || !Array.isArray(item.files) || item.files.length === 0) return [];
        if (item._sourceCurvesPromise) return item._sourceCurvesPromise;
        item._sourceCurvesPromise = (async () => {
            const freqs = this.grid();
            const out = [];
            for (let i = 0; i < item.files.length; i++) {
                const filePath = item.files[i];
                const ok = await CurveIndexer.loadCurve(item, i);
                if (!ok) continue;
                const data = (item.sourcesCache && item.sourcesCache[filePath]) || (i === 0 ? item.data : null);
                if (!data || data.length < 2) continue;
                let norm;
                try { norm = CurveUtils.normalizeTo75dB(data, 500, 75); } catch (e) { continue; }
                const interp = CurveUtils.cubicSplineInterpolate(norm, freqs);
                const meta = this.parsePath(filePath);
                out.push({
                    index: i,
                    path: filePath,
                    source: meta.source,
                    sourceLabel: this.sourceLabel(meta.source),
                    file: meta.file,
                    condition: meta.condition,
                    conditionLabel: this.conditionLabel(filePath),
                    isMod: meta.isMod,
                    interp: Array.from(interp)
                });
            }
            return out;
        })().finally(() => { item._sourceCurvesPromise = null; });
        return item._sourceCurvesPromise;
    },

    median: function (values) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    },

    quantile: function (values, q) {
        if (!values.length) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const pos = (sorted.length - 1) * q;
        const base = Math.floor(pos);
        const rest = pos - base;
        if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
        return sorted[base];
    },

    // Median curve across a set of source curves, plus the average p10-p90
    // half-width (used as the "±x dB" uncertainty readout).
    consensusOf: function (curves) {
        if (!curves || !curves.length) return { interp: null, spread: 0, count: 0 };
        const points = curves[0].interp.length;
        const median = new Float32Array(points);
        let spread = 0;
        for (let i = 0; i < points; i++) {
            const column = curves.map(c => c.interp[i]);
            median[i] = this.median(column);
            spread += (this.quantile(column, 0.9) - this.quantile(column, 0.1)) / 2;
        }
        return { interp: median, spread: spread / points, count: curves.length };
    }
};

if (typeof window !== 'undefined') window.SourceIndex = SourceIndex;
