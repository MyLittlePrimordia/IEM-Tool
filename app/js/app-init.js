
        (function() {
            // Skip ranges already styled for their current value: the 1s tick
            // otherwise re-reads each slider's computed style on every pass,
            // even when nothing changed since the last update.
            const _lastFill = new WeakMap();
            function updateFill(el) {
                const min = parseFloat(el.min) || 0;
                const max = parseFloat(el.max) || 100;
                const val = parseFloat(el.value) || 0;
                const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;
                const target = pct + '%';
                if (_lastFill.get(el) === val + '|' + target) return;
                _lastFill.set(el, val + '|' + target);
                // Write BOTH names. --range-fill is the one the stylesheet reads
                // (app.css: the input[type=range] track rule); --track-percent
                // is still read by the EQ band cards and anything else that
                // sets it directly. They were the same idea under two names and
                // never met, which is why no slider showed a fill.
                if (el.style.getPropertyValue('--range-fill') !== target) {
                    el.style.setProperty('--range-fill', target);
                }
                if (el.style.getPropertyValue('--track-percent') !== target) {
                    el.style.setProperty('--track-percent', target);
                }
            }
            document.addEventListener('input', (e) => {
                if (e.target && e.target.matches && e.target.matches('input[type="range"]')) updateFill(e.target);
            }, true);
            // updateFill normally runs from an `input` event or from the boot
            // sweep below. Neither covers code that assigns el.value directly:
            // no event fires, so --range-fill keeps whatever percentage the
            // slider had before, and the knob ends up sitting somewhere the
            // coloured fill does not reach - which reads as a detached knob.
            // Anything that moves a slider programmatically should call this.
            window.IEM_updateRangeFill = updateFill;

            // ROOT-CAUSE FIX for "the coloured bar does not follow the knob".
            // The stylesheet paints the fill from --range-fill, but that variable
            // was only refreshed by `input` events (user drags) and the boot sweep.
            // Code that moves a slider with `el.value = x` (Clear, presets, AutoEQ,
            // undo, Smart import, remembered EQ, graph-node drags...) fires no
            // event, so the knob jumped while the bar stayed at its old position.
            // Callers were meant to remember to call a repaint helper and many did
            // not (or called an older painter whose output the stylesheet ignores).
            // Instead of auditing every present and future caller, repaint whenever
            // a range input's value is assigned. updateFill is memoised, so repeat
            // writes of an unchanged value cost one WeakMap lookup.
            (function hookRangeValueWrites() {
                const proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
                if (!proto) return;
                ['value', 'valueAsNumber'].forEach(function (prop) {
                    const desc = Object.getOwnPropertyDescriptor(proto, prop);
                    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return;
                    Object.defineProperty(proto, prop, {
                        configurable: true,
                        enumerable: desc.enumerable,
                        get: desc.get,
                        set: function (v) {
                            desc.set.call(this, v);
                            if (this.type === 'range') updateFill(this);
                        }
                    });
                });
            })();
            // A changed min/max moves the knob's relative position too.
            const _rangeBoundsObserver = new MutationObserver(function (muts) {
                for (const m of muts) {
                    if (m.target && m.target.matches && m.target.matches('input[type="range"]')) updateFill(m.target);
                }
            });
            const _observeRangeBounds = function () {
                if (document.body) _rangeBoundsObserver.observe(document.body, { attributes: true, attributeFilter: ['min', 'max'], subtree: true });
            };
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _observeRangeBounds, { once: true });
            else _observeRangeBounds();
            function initAll() {
                // Do NOT gate on document.hasFocus(). That guard made the initial
                // pass a no-op whenever the window was not focused - which is
                // every launch, and any harness run - so no slider had a fill
                // until the user happened to drag it. This is one pass over the
                // ranges; there is nothing to protect against.
                document.querySelectorAll('input[type="range"]').forEach(updateFill);
            }
            // Bind with a readyState check, like setup() at the bottom of this
            // file. The bundle is loaded at the end of <body> and can execute
            // AFTER DOMContentLoaded has already fired, in which case a bare
            // addEventListener never runs and no slider is ever painted
            // initially. That was the real reason sliders showed a bare track:
            // only the ones the user happened to drag got a fill.
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initAll, { once: true });
            } else {
                initAll();
            }

            // Several sliders are created by JS after boot (driver tiles, review
            // cards, per-band graph rows), so a single boot pass misses them and
            // they stay empty until touched.
            const _rangeObserver = new MutationObserver((muts) => {
                for (const m of muts) {
                    for (const node of m.addedNodes) {
                        if (node.nodeType !== 1) continue;
                        if (node.matches && node.matches('input[type="range"]')) updateFill(node);
                        if (node.querySelectorAll) {
                            node.querySelectorAll('input[type="range"]').forEach(updateFill);
                        }
                    }
                }
            });
            const _observeRanges = () => {
                if (document.body) _rangeObserver.observe(document.body, { childList: true, subtree: true });
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', _observeRanges, { once: true });
            } else {
                _observeRanges();
            }

            // 3s polling removed: input listener + visibilitychange + syncGlobalSliders
            // already keep fill bars coherent. The interval was waking the tab every
            // 3s even when hidden/idle.
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) initAll();
            });

            // Best-effort worker cleanup on unload: background workers keep
            // the renderer alive on some engines (e.g. Firefox's bfcache),
            // pinning large structured-cloned datasets in memory.
            window.addEventListener('pagehide', () => {
                try {
                    // typeof guards, NOT window.FindEngine: FindEngine is a
                    // top-level const in the bundle (a lexical binding, never
                    // a window property), so the old window.FindEngine checks
                    // were always false and this cleanup never ran.
                    if (typeof FindEngine !== 'undefined' && FindEngine._findWorker) FindEngine._findWorker.terminate();
                    if (typeof EQ !== 'undefined' && EQ._loudnessWorkerBlobUrl) { try { URL.revokeObjectURL(EQ._loudnessWorkerBlobUrl); } catch(_){} EQ._loudnessWorkerBlobUrl = null; }
                } catch (_) {}
            });
        })();

        (function() {
            function setup() {
                const slider = document.getElementById('tone-slider');
                const freqDisplay = document.getElementById('tone-freq');
                if (!slider || !freqDisplay) return;

                const MIN = 0, MAX = 20000;

                const commitValue = (val) => {
                    val = Math.max(MIN, Math.min(MAX, Math.round(val)));
                    slider.value = val;
                    slider.dispatchEvent(new Event('input', { bubbles: true }));
                };

                freqDisplay.style.cursor = 'pointer';
                freqDisplay.title = 'Click to type an exact Hz value';
                freqDisplay.addEventListener('click', () => {
                    if (freqDisplay.querySelector('input')) return;
                    const currentHz = parseFloat(slider.value) || 0;
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.min = MIN; input.max = MAX; input.step = 1;
                    input.value = currentHz;
                    input.className = 'w-24 bg-[var(--bg-input)] border border-[var(--border-color)] text-2xl font-black text-[var(--accent-amber)] px-1';
                    freqDisplay.textContent = '';
                    freqDisplay.appendChild(input);
                    input.focus();
                    input.select();

                    let committed = false;
                    const restore = () => { freqDisplay.textContent = slider.value + ' Hz'; };
                    const commitAndRestore = () => {
                        committed = true;
                        const val = Math.max(MIN, Math.min(MAX, Math.round(parseFloat(input.value) || 0)));
                        commitValue(val);
                        restore();
                    };
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { commitAndRestore(); }
                        else if (e.key === 'Escape') { committed = true; restore(); }
                        e.stopPropagation();
                    });
                    input.addEventListener('blur', () => {
                        if (committed) return;
                        // An empty/invalid box restores the previous value
                        // instead of silently committing 0 Hz.
                        if (!input.value.trim() || isNaN(parseFloat(input.value))) { restore(); return; }
                        commitAndRestore();
                    });
                    input.addEventListener('click', (e) => e.stopPropagation());
                });
            }
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', setup);
            } else {
                setup();
            }
        })();
