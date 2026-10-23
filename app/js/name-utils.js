/* Canonical IEM name normalisation — SINGLE SOURCE OF TRUTH.
 *
 * The same ~60 rules existed twice: `FindEngine.sanitizeName` in find-engine.js
 * (main-thread fallback) and a bare `sanitizeName` in find-worker.js. Their
 * comments admitted they were "kept in sync" by hand. Any rule added to one and
 * not the other changes how entries group, so the same database produced
 * different canonical profiles — and different Endgame/Giant-Killer results —
 * depending on whether the Worker was available.
 *
 * Loaded by:
 *   - the renderer bundle (before the find-* files), and
 *   - find-worker.js via importScripts().
 *
 * Pure logic: no DOM, no I/O, no page state.
 */
const NameUtils = (function () {
    'use strict';

    // Reduce a measurement's display name to the base model it describes:
    // strips source suffixes ("x Crinacle"), switch/plug/tip/nozzle variants,
    // impedance and connector notes, version and edition markers, then
    // title-cases the result. "" means "cannot be grouped".
    function sanitizeName(name) {
        // Coerce at the boundary: a truthy non-string (e.g. a number, an
        // object) would reach .toLowerCase() and throw.
        if (typeof name !== 'string') name = (name == null) ? '' : String(name);
        if (!name) return "";
        let clean = name.toLowerCase();

        clean = clean.replace(/[\(\[][^\]\)]*[\)\]]/g, '');

        clean = clean.replace(/\s*x\s*(?:hbb|crinacle|crin|zeos|gizaudio|fresh reviews|jays audio|divinus|seeaudio|akros|ducbloke|community|fresh|z reviews|z)\b/g, '');

        clean = clean.replace(/\b(?!dudu\b)[ud]{4}\b/g, '');
        clean = clean.replace(/\b[ud]{2,3}\b/g, '');
        clean = clean.replace(/\b[01]{2,4}\b/g, '');
        clean = clean.replace(/\b[1-5]\s+[1-5]\b/g, '');
        clean = clean.replace(/\b(?:all on|all off|bc on|bc off)\b/g, '');
        clean = clean.replace(/\s*(?:bass|treble|reference|ref|mid|midrange)?\s*(?:switch|sw|switches)\s*(?:on|off|up|down|1|2|3|4|0)*\b/g, '');

        clean = clean.replace(/\b\d+\s*(?:Ω|ohm|ohms|o)\b/g, '');
        clean = clean.replace(/\b(?:high|low|s\s+high|s\s+low)\s*(?:Ω|ohm|ohms|impedance)\b/g, '');

        clean = clean.replace(/\b(?:\d+\.\d+mm|\d+mm|3\.5|4\.4|usb\s+c|type\s+c|usb|tws|anc|analog|digital|dsp)\b/g, '');
        clean = clean.replace(/\s*(?:gold|grey|gray|silver|default)?\s*(?:plug|cable|connection|connector|adapter|headband|wire)\b/g, '');

        clean = clean.replace(/\s*(?:foam|silicone|silicon|yaxi|spinfit|symbio|starline|widebore|narrowbore|final|clear|red|blue|grey|gray|stock|custom|my|dunu\s+ss)\s*(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');
        clean = clean.replace(/\b(?:tips|eartips|eartip|tip|pads|pad)\b/g, '');

        clean = clean.replace(/\s*(?:blue|gold|silver|red|black|green|brass|steel|titanium|ti|short\s+black|short\s+red|alt|reference|ref|hifi|pop|vocal|instrumental|monitor|balanced|classic|default|standard|std)?\s*(?:nozzles?|rings?|filters?|mesh|damper|vent|mod|mods|taped?|tanya|microtape)\b/g, '');

        clean = clean.replace(/\b(?:v\d+(?:\.\d+)?|mk[ivx\d]+b?)\b/g, '');
        clean = clean.replace(/\b(?:\d+st|\d+nd|\d+rd|\d+th)\s+(?:gen|generation|unit|anniversary|anniv)\b/g, '');
        clean = clean.replace(/\b(?:og|gen|generation|unit|anniversary|anniv|re\s+set|preprod|pre\s+retail|retail|sample\s*\d*|sample)\b/g, '');

        clean = clean.replace(/\b(?:edition|standard|std|default|reference|ref|stock|base|baseline|pro\s+max|pro|max|ltd|limited|custom\s+resin|resin)\b/g, '');

        clean = clean.replace(/\s+/g, ' ').trim();

        return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }

    return { sanitizeName: sanitizeName };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NameUtils;
